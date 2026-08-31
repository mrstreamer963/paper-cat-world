import { fail, CoreError } from "../errors.js";
import { matrixFromTransform, invertMatrix, multiplyMatrices, decomposeMatrix } from "../geometry/matrix.js";
import { aabbIntersects, isFinitePoint, isSimplePolygon, normalizeClosedContour, pointInPolygon, pointsAabb, polygonCentroid, signedPolygonArea } from "../geometry/polygon.js";
import { getSurfaceWorldMatrixQuery, isSurfaceVisible } from "../queries.js";
import { validateWorldState } from "../validate.js";

const COMMANDS = new Set(["createEntity", "deleteEntity", "moveEntity", "moveEntityInWorld", "setEntityTransform", "bringEntityToFront", "setSurfaceVisibility", "createDrawing", "deleteDrawing", "addStroke", "removeStroke", "createCutout"]);
const cloneTransform = (value) => ({ x: value.x, y: value.y, rotation: value.rotation, scale: value.scale });

function assertId(value, name) {
  if (typeof value !== "string" || value.length === 0) throw fail("INVALID_REFERENCE", `${name} must be a non-empty string`, { [name]: value });
}

function assertTransform(world, transform) {
  if (!transform || typeof transform !== "object") throw fail("INVALID_TRANSFORM", "A transform is required");
  for (const field of ["x", "y", "rotation", "scale"]) {
    if (!Number.isFinite(transform[field])) throw fail("INVALID_NUMBER", `${field} must be finite`, { field, value: transform[field] });
  }
  if (transform.scale < world.rules.minScale || transform.scale > world.rules.maxScale) {
    throw fail("INVALID_TRANSFORM", "Scale is outside the configured range", { scale: transform.scale });
  }
}

function requireEntity(world, entityId) {
  assertId(entityId, "entityId");
  const entity = world.entities[entityId];
  if (!entity) throw fail("ENTITY_NOT_FOUND", `Entity ${entityId} was not found`, { entityId });
  return entity;
}

function requireSurface(world, surfaceId) {
  assertId(surfaceId, "surfaceId");
  const surface = world.surfaces[surfaceId];
  if (!surface) throw fail("SURFACE_NOT_FOUND", `Surface ${surfaceId} was not found`, { surfaceId });
  return surface;
}

function assertTarget(world, entityId, targetSurface, transform) {
  if (!isSurfaceVisible(world, targetSurface.id)) throw fail("TARGET_NOT_VISIBLE", "Target surface is not visible", { surfaceId: targetSurface.id });
  if (!pointInPolygon({ x: transform.x, y: transform.y }, targetSurface.placementArea, world.rules.geometryEpsilon)) {
    throw fail("OUTSIDE_PLACEMENT_AREA", "Entity anchor is outside the target placement area", { surfaceId: targetSurface.id, x: transform.x, y: transform.y });
  }
  let hostEntityId = targetSurface.hostEntityId;
  const visited = new Set();
  while (hostEntityId !== null) {
    if (hostEntityId === entityId || visited.has(hostEntityId)) throw fail("CYCLE_DETECTED", "Move would create a nesting cycle", { entityId, surfaceId: targetSurface.id });
    visited.add(hostEntityId);
    const host = requireEntity(world, hostEntityId);
    hostEntityId = requireSurface(world, host.surfaceId).hostEntityId;
  }
}

function nextZIndex(world, surfaceId) {
  const siblings = Object.values(world.entities).filter((entity) => entity.surfaceId === surfaceId)
    .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id));
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((entity) => entity.zIndex)) + 1;
}

function movedWorld(world, entity, targetSurfaceId, transform, zPolicy = "preserve") {
  if (zPolicy !== "preserve" && zPolicy !== "front") throw fail("INVALID_REFERENCE", "Unknown zPolicy", { zPolicy });
  const targetSurface = requireSurface(world, targetSurfaceId);
  assertTransform(world, transform);
  assertTarget(world, entity.id, targetSurface, transform);
  const zIndex = zPolicy === "front" ? nextZIndex(world, targetSurfaceId) : entity.zIndex;
  const updated = { ...entity, surfaceId: targetSurfaceId, transform: cloneTransform(transform), zIndex };
  return {
    ...world,
    entities: { ...world.entities, [entity.id]: updated },
  };
}

function createEntity(world, command) {
  const entity = command.entity;
  if (!entity || typeof entity !== "object") throw fail("INVALID_REFERENCE", "entity is required");
  assertId(entity.id, "id");
  if (world.entities[entity.id] || world.surfaces[entity.id]) throw fail("DUPLICATE_ID", `ID ${entity.id} already exists`, { id: entity.id });
  requireSurface(world, entity.surfaceId);
  assertTransform(world, entity.transform);
  if (!Number.isFinite(entity.zIndex)) throw fail("INVALID_NUMBER", "zIndex must be finite", { value: entity.zIndex });
  const owned = command.surfaces ?? [];
  if (!Array.isArray(owned)) throw fail("INVALID_REFERENCE", "surfaces must be an array");
  const ids = new Set([entity.id]);
  const newSurfaces = {};
  for (const surface of owned) {
    assertId(surface?.id, "surfaceId");
    if (ids.has(surface.id) || world.entities[surface.id] || world.surfaces[surface.id]) throw fail("DUPLICATE_ID", `ID ${surface.id} already exists`, { id: surface.id });
    ids.add(surface.id);
    if (surface.hostEntityId !== entity.id) throw fail("INVALID_REFERENCE", "Owned surface must reference the new entity", { surfaceId: surface.id, hostEntityId: surface.hostEntityId });
    if (surface.kind !== "generic") throw fail("INVALID_REFERENCE", "Owned surfaces must be generic", { kind: surface.kind });
    assertTransform(world, surface.transform);
    if (!isSimplePolygon(surface.placementArea, world.rules.geometryEpsilon)) throw fail("INVALID_POLYGON", "placementArea must be a simple non-degenerate polygon", { surfaceId: surface.id });
    if (surface.localVisibility !== "visible" && surface.localVisibility !== "hidden") throw fail("INVALID_REFERENCE", "Invalid surface visibility", { value: surface.localVisibility });
    newSurfaces[surface.id] = { ...surface, transform: cloneTransform(surface.transform), placementArea: surface.placementArea.map((point) => ({ ...point })) };
  }
  assertTarget(world, entity.id, world.surfaces[entity.surfaceId], entity.transform);
  const next = {
    ...world,
    entities: { ...world.entities, [entity.id]: { ...entity, transform: cloneTransform(entity.transform) } },
    surfaces: { ...world.surfaces, ...newSurfaces },
  };
  return { world: next, events: [{ type: "entityCreated", entityId: entity.id }] };
}

function cloneStroke(stroke) { return { ...stroke, points: stroke.points.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure ?? .5 })) }; }
function assertDrawing(drawing) {
  assertId(drawing?.id, "drawingId");
  if (!Number.isFinite(drawing.width) || drawing.width <= 0 || !Number.isFinite(drawing.height) || drawing.height <= 0) throw fail("INVALID_NUMBER", "Drawing dimensions must be positive");
  if (!Array.isArray(drawing.strokes)) throw fail("INVALID_STROKE", "strokes must be an array");
}
function assertStroke(stroke) {
  if (!stroke || typeof stroke !== "object" || typeof stroke.id !== "string" || !stroke.id || !["brush", "eraser"].includes(stroke.tool) || !Number.isFinite(stroke.width) || stroke.width <= 0 || !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.some((p) => !isFinitePoint(p) || !Number.isFinite(p.pressure ?? .5) || (p.pressure ?? .5) < 0 || (p.pressure ?? .5) > 1)) throw fail("INVALID_STROKE", "Stroke is invalid");
}
function createDrawing(world, command) {
  const input = command.drawing ?? command;
  assertDrawing(input);
  if (world.drawings[input.id] || world.entities[input.id] || world.surfaces[input.id]) throw fail("DUPLICATE_ID", `ID ${input.id} already exists`);
  const strokes = input.strokes.map((s) => { assertStroke(s); return cloneStroke(s); });
  if (new Set(strokes.map((s) => s.id)).size !== strokes.length) throw fail("INVALID_STROKE", "Stroke IDs must be unique");
  const drawing = { id: input.id, width: input.width, height: input.height, background: input.background ?? "transparent", strokes, revision: input.revision ?? 0 };
  return { world: { ...world, drawings: { ...world.drawings, [drawing.id]: drawing } }, events: [{ type: "drawingChanged", drawingId: drawing.id, revision: drawing.revision }] };
}
function deleteDrawing(world, command) {
  assertId(command.drawingId, "drawingId"); const drawing = world.drawings[command.drawingId];
  if (!drawing) throw fail("DRAWING_NOT_FOUND", "Drawing was not found", { drawingId: command.drawingId });
  if (Object.values(world.entities).some((e) => e.drawingId === drawing.id)) throw fail("DRAWING_IN_USE", "Drawing is referenced", { drawingId: drawing.id });
  const drawings = { ...world.drawings }; delete drawings[drawing.id];
  return { world: { ...world, drawings }, events: [{ type: "drawingChanged", drawingId: drawing.id, deleted: true }] };
}
function changeStroke(world, command, remove = false) {
  const drawing = world.drawings[command.drawingId]; if (!drawing) throw fail("DRAWING_NOT_FOUND", "Drawing was not found");
  let strokes;
  if (remove) { const i = drawing.strokes.findIndex((s) => s.id === command.strokeId); if (i < 0) throw fail("STROKE_NOT_FOUND", "Stroke was not found"); strokes = drawing.strokes.filter((_, j) => j !== i); }
  else { assertStroke(command.stroke); if (drawing.strokes.some((s) => s.id === command.stroke.id)) throw fail("DUPLICATE_ID", "Stroke ID already exists"); strokes = [...drawing.strokes, cloneStroke(command.stroke)]; }
  const next = { ...drawing, strokes, revision: drawing.revision + 1 };
  return { world: { ...world, drawings: { ...world.drawings, [drawing.id]: next } }, events: [{ type: "drawingChanged", drawingId: drawing.id, revision: next.revision }] };
}
function deleteEntity(world, command) {
  const entity = requireEntity(world, command.entityId); const owned = Object.values(world.surfaces).filter((s) => s.hostEntityId === entity.id);
  if (owned.some((s) => Object.values(world.entities).some((e) => e.surfaceId === s.id))) throw fail("ENTITY_NOT_EMPTY", "Entity contains placed content", { entityId: entity.id });
  const entities = { ...world.entities }, surfaces = { ...world.surfaces }, drawings = { ...world.drawings }; delete entities[entity.id]; owned.forEach((s) => delete surfaces[s.id]);
  if (entity.kind === "cutout" && !Object.values(entities).some((e) => e.drawingId === entity.drawingId)) delete drawings[entity.drawingId];
  return { world: { ...world, entities, surfaces, drawings }, events: [{ type: "entityDeleted", entityId: entity.id }] };
}
function createCutout(world, command) {
  const sourceId = command.sourceDrawingId ?? command.drawingId; const source = world.drawings[sourceId]; if (!source) throw fail("DRAWING_NOT_FOUND", "Source drawing was not found");
  const close = normalizeClosedContour(command.contour, command.closeDistance ?? world.rules.contourCloseDistance, world.rules.geometryEpsilon);
  if (!close.ok) throw fail(close.code, "Contour is invalid");
  if (Math.abs(signedPolygonArea(close.contour)) < world.rules.minCutoutArea) throw fail("CONTOUR_TOO_SMALL", "Contour area is too small");
  const anchor = polygonCentroid(close.contour, world.rules.geometryEpsilon); if (!anchor) throw fail("INVALID_CONTOUR", "Contour centroid is invalid");
  const drawingId = command.newDrawingId ?? command.cutoutDrawingId; const entityId = command.entityId; assertId(drawingId, "newDrawingId"); assertId(entityId, "entityId");
  if (world.drawings[drawingId] || world.entities[entityId] || world.surfaces[entityId]) throw fail("DUPLICATE_ID", "Cutout ID already exists");
  const box = pointsAabb(close.contour); const shifted = close.contour.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }));
  const strokes = source.strokes.filter((s) => aabbIntersects(pointsAabb(s.points, s.width / 2), box)).map((s) => ({ ...cloneStroke(s), points: s.points.map((p) => ({ ...p, x: p.x - anchor.x, y: p.y - anchor.y })) }));
  const drawing = { id: drawingId, width: box.maxX - box.minX, height: box.maxY - box.minY, background: "transparent", strokes, revision: 0 };
  const position = command.worldPosition ?? command.position ?? anchor; const surfaceId = command.targetSurfaceId ?? world.table.surfaceId;
  const entity = { id: entityId, kind: "cutout", label: command.label ?? "Вырезка", drawingId, contour: shifted, anchor: { x: 0, y: 0 }, width: drawing.width, height: drawing.height, surfaceId, transform: { x: position.x, y: position.y, rotation: 0, scale: 1 }, zIndex: nextZIndex(world, surfaceId) };
  const withDrawing = { ...world, drawings: { ...world.drawings, [drawingId]: drawing } }; const made = createEntity(withDrawing, { type: "createEntity", entity });
  return { world: made.world, events: [{ type: "drawingChanged", drawingId, revision: 0 }, ...made.events] };
}

function execute(world, command) {
  if (!command || typeof command !== "object" || !COMMANDS.has(command.type)) throw fail("UNKNOWN_COMMAND", "Unknown command", { type: command?.type });
  if (command.type === "createEntity") return createEntity(world, command);
  if (command.type === "createDrawing") return createDrawing(world, command);
  if (command.type === "deleteDrawing") return deleteDrawing(world, command);
  if (command.type === "addStroke") return changeStroke(world, command);
  if (command.type === "removeStroke") return changeStroke(world, command, true);
  if (command.type === "deleteEntity") return deleteEntity(world, command);
  if (command.type === "createCutout") return createCutout(world, command);
  if (command.type === "setSurfaceVisibility") {
    const surface = requireSurface(world, command.surfaceId);
    if (surface.kind !== "generic") throw fail("INVALID_REFERENCE", "Only generic surfaces can change visibility", { surfaceId: surface.id });
    if (command.visibility !== "visible" && command.visibility !== "hidden") throw fail("INVALID_REFERENCE", "Invalid visibility", { visibility: command.visibility });
    return { world: { ...world, surfaces: { ...world.surfaces, [surface.id]: { ...surface, localVisibility: command.visibility } } }, events: [{ type: "surfaceVisibilityChanged", surfaceId: surface.id, visibility: command.visibility }] };
  }
  const entity = requireEntity(world, command.entityId);
  if (command.type === "bringEntityToFront") {
    const zIndex = nextZIndex(world, entity.surfaceId);
    return { world: { ...world, entities: { ...world.entities, [entity.id]: { ...entity, zIndex } } }, events: [{ type: "entityBroughtToFront", entityId: entity.id, zIndex }] };
  }
  let targetSurfaceId = command.type === "setEntityTransform" ? entity.surfaceId : command.targetSurfaceId;
  let transform = command.transform;
  if (command.type === "moveEntityInWorld") {
    assertTransform(world, command.transform);
    const targetMatrix = getSurfaceWorldMatrixQuery(world, targetSurfaceId);
    const inverse = invertMatrix(targetMatrix, world.rules.geometryEpsilon);
    const localMatrix = inverse && multiplyMatrices(inverse, matrixFromTransform(command.transform));
    transform = localMatrix && decomposeMatrix(localMatrix, world.rules.geometryEpsilon);
    if (!transform) throw fail("INVALID_TRANSFORM", "World transform cannot be represented locally", { entityId: entity.id, surfaceId: targetSurfaceId });
  }
  const next = movedWorld(world, entity, targetSurfaceId, transform, command.zPolicy);
  return { world: next, events: [{ type: "entityMoved", entityId: entity.id, fromSurfaceId: entity.surfaceId, toSurfaceId: targetSurfaceId }] };
}

export function applyWorldCommand(world, command) {
  try {
    const baseline = validateWorldState(world);
    if (!baseline.ok) throw fail("INVALID_REFERENCE", "Input world is invalid", { errors: baseline.errors });
    const result = execute(world, command);
    const validation = validateWorldState(result.world);
    if (!validation.ok) throw fail(validation.errors[0].code, "Command would create an invalid world", { errors: validation.errors });
    return { ok: true, ...result };
  } catch (error) {
    const normalized = error instanceof CoreError ? error : fail("INVALID_REFERENCE", error.message);
    return { ok: false, world, error: { code: normalized.code, message: normalized.message, details: normalized.details } };
  }
}
