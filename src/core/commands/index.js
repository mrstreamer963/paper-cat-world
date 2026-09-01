import { fail, CoreError } from "../errors.js";
import { matrixFromTransform, invertMatrix, multiplyMatrices, decomposeMatrix } from "../geometry/matrix.js";
import { aabbIntersects, isFinitePoint, isSimplePolygon, normalizeClosedContour, pointInPolygon, pointsAabb, polygonCentroid, polygonIntersectionArea, signedPolygonArea } from "../geometry/polygon.js";
import { getEntityWorldTransformQuery, getSurfaceWorldMatrixQuery, isEntityVisibleQuery, isSurfaceVisible } from "../queries.js";
import { validateWorldState } from "../validate.js";

const COMMANDS = new Set(["createEntity", "deleteEntity", "moveEntity", "moveEntityInWorld", "setEntityTransform", "bringEntityToFront", "setSurfaceVisibility", "createDrawing", "deleteDrawing", "addStroke", "removeStroke", "createCutout", "createCat", "createWearableCutout", "attachWearable", "detachWearable", "holdEntity", "releaseHeldEntity", "createSheet", "toggleSheet", "setSheetState", "createNotebook", "setNotebookState", "setActiveSpread"]);
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
    if (!["generic", "cat-attachments", "sheet-inside", "sheet-outer-top", "sheet-outer-bottom", "notebook-cover", "notebook-spread"].includes(surface.kind)) throw fail("INVALID_REFERENCE", "Invalid owned surface kind", { kind: surface.kind });
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

const rectangle = (width, height) => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
const zeroTransform = () => ({ x: 0, y: 0, rotation: 0, scale: 1 });
function drawingInput(command, role, id, width, height) {
  const supplied = command.drawings?.[role] ?? command[`${role}Drawing`];
  return supplied ?? { id, width, height, background: command.colors?.[role] ?? "#f7e7bd", strokes: [] };
}
function addDrawingsAtomically(world, drawings) {
  let next = world; const events = [];
  for (const drawing of drawings) { const result = createDrawing(next, { drawing }); next = result.world; events.push(...result.events); }
  return { world: next, events };
}
function createSheet(world, command) {
  const sheetId = command.sheetId ?? command.entityId; assertId(sheetId, "sheetId");
  const ids = { inside: command.insideSurfaceId, outerTop: command.outerTopSurfaceId, outerBottom: command.outerBottomSurfaceId };
  const drawingIds = { inside: command.insideDrawingId, outerTop: command.outerTopDrawingId, outerBottom: command.outerBottomDrawingId };
  for (const [key, value] of Object.entries({ ...ids, ...Object.fromEntries(Object.entries(drawingIds).map(([k,v]) => [`${k}Drawing`, v])) })) assertId(value, key);
  const width = command.width ?? 320, height = command.height ?? 220;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw fail("INVALID_SHEET", "Sheet dimensions are invalid");
  const madeDrawings = addDrawingsAtomically(world, Object.keys(drawingIds).map((role) => drawingInput(command, role, drawingIds[role], role === "inside" ? width : width / 2, height)));
  const entity = { id: sheetId, kind: "sheet", label: command.label ?? "Складной лист", state: command.state ?? "closed", insideSurfaceId: ids.inside, outerTopSurfaceId: ids.outerTop, outerBottomSurfaceId: ids.outerBottom, width, height, surfaceId: command.targetSurfaceId ?? world.table.surfaceId, transform: command.transform ?? command.worldTransform, zIndex: command.zIndex ?? nextZIndex(world, command.targetSurfaceId ?? world.table.surfaceId) };
  const surfaces = [["inside", "sheet-inside"], ["outerTop", "sheet-outer-top"], ["outerBottom", "sheet-outer-bottom"]].map(([role, kind]) => ({ id: ids[role], kind, hostEntityId: sheetId, drawingId: drawingIds[role], transform: role === "inside" ? zeroTransform() : { x: width / 2, y: 0, rotation: 0, scale: 1 }, placementArea: rectangle(role === "inside" ? width : width / 2, height), localVisibility: "visible" }));
  const made = createEntity(madeDrawings.world, { entity, surfaces });
  return { world: made.world, events: [...madeDrawings.events, ...made.events, { type: "sheetCreated", sheetId }] };
}
function setSheetState(world, command) { const sheet = requireEntity(world, command.sheetId ?? command.entityId); if (sheet.kind !== "sheet") throw fail("NOT_A_SHEET", "Entity is not a sheet", { entityId: sheet.id }); if (!["open", "closed"].includes(command.state)) throw fail("INVALID_SHEET", "Invalid sheet state"); if (!isEntityVisibleQuery(world, sheet.id)) throw fail("HOST_NOT_VISIBLE", "Sheet is not visible"); if (sheet.state === command.state) return { world, events: [] }; const updated = { ...sheet, state: command.state }; return { world: { ...world, entities: { ...world.entities, [sheet.id]: updated } }, events: [{ type: "sheetStateChanged", sheetId: sheet.id, previousState: sheet.state, state: updated.state, newState: updated.state }] }; }
function createNotebook(world, command) {
  const notebookId = command.notebookId ?? command.entityId; assertId(notebookId, "notebookId"); assertId(command.coverSurfaceId, "coverSurfaceId"); assertId(command.coverDrawingId, "coverDrawingId");
  if (!Array.isArray(command.spreads) || command.spreads.length === 0) throw fail("INVALID_NOTEBOOK", "Notebook needs at least one spread");
  const width = command.width ?? 420, height = command.height ?? 260;
  const drawingSpecs = [{ role: "cover", id: command.coverDrawingId }, ...command.spreads.map((s) => ({ role: s.id, id: s.drawingId, supplied: s.drawing }))];
  for (const spread of command.spreads) { assertId(spread?.id, "spreadId"); assertId(spread?.surfaceId, "surfaceId"); assertId(spread?.drawingId, "drawingId"); }
  const madeDrawings = addDrawingsAtomically(world, drawingSpecs.map((s) => s.supplied ?? command.drawings?.[s.role] ?? { id: s.id, width, height, background: s.role === "cover" ? "#b96955" : "#fff7de", strokes: [] }));
  const state = command.state ?? "closed", activeSpreadIndex = command.activeSpreadIndex ?? 0;
  const spreads = command.spreads.map(({ id, surfaceId, drawingId }) => ({ id, surfaceId, drawingId }));
  const entity = { id: notebookId, kind: "notebook", label: command.label ?? "Тетрадь-дом", state, coverSurfaceId: command.coverSurfaceId, activeSpreadIndex, spreads, width, height, surfaceId: command.targetSurfaceId ?? world.table.surfaceId, transform: command.transform ?? command.worldTransform, zIndex: command.zIndex ?? nextZIndex(world, command.targetSurfaceId ?? world.table.surfaceId) };
  const surfaces = [{ id: command.coverSurfaceId, kind: "notebook-cover", hostEntityId: notebookId, drawingId: command.coverDrawingId, transform: zeroTransform(), placementArea: rectangle(width, height), localVisibility: "visible" }, ...spreads.map((s) => ({ id: s.surfaceId, kind: "notebook-spread", hostEntityId: notebookId, drawingId: s.drawingId, transform: zeroTransform(), placementArea: rectangle(width, height), localVisibility: "visible" }))];
  const made = createEntity(madeDrawings.world, { entity, surfaces }); return { world: made.world, events: [...madeDrawings.events, ...made.events, { type: "notebookCreated", notebookId }] };
}
function requireNotebook(world, command) { const notebook = requireEntity(world, command.notebookId ?? command.entityId); if (notebook.kind !== "notebook") throw fail("NOT_A_NOTEBOOK", "Entity is not a notebook", { entityId: notebook.id }); return notebook; }
function setNotebookState(world, command) { const notebook = requireNotebook(world, command); if (!["open", "closed"].includes(command.state)) throw fail("INVALID_NOTEBOOK", "Invalid notebook state"); if (!isEntityVisibleQuery(world, notebook.id)) throw fail("HOST_NOT_VISIBLE", "Notebook is not visible"); if (notebook.state === command.state) return { world, events: [] }; const updated = { ...notebook, state: command.state }; return { world: { ...world, entities: { ...world.entities, [notebook.id]: updated } }, events: [{ type: "notebookStateChanged", notebookId: notebook.id, previousState: notebook.state, state: updated.state, newState: updated.state }] }; }
function setActiveSpread(world, command) { const notebook = requireNotebook(world, command); const index = command.activeSpreadIndex ?? command.index; if (!Number.isInteger(index) || index < 0 || index >= notebook.spreads.length) throw fail("INVALID_SPREAD_INDEX", "Spread index is out of range", { index }); if (notebook.state !== "open" || !isEntityVisibleQuery(world, notebook.id)) throw fail("HOST_NOT_VISIBLE", "Open notebook is not visible"); if (index === notebook.activeSpreadIndex) return { world, events: [] }; const updated = { ...notebook, activeSpreadIndex: index }; return { world: { ...world, entities: { ...world.entities, [notebook.id]: updated } }, events: [{ type: "activeSpreadChanged", notebookId: notebook.id, previousIndex: notebook.activeSpreadIndex, activeSpreadIndex: index, newIndex: index }] }; }

function requireTemplate(world, templateId) {
  const template = world.rules.templates?.[templateId];
  if (!template) throw fail("TEMPLATE_NOT_FOUND", `Template ${templateId} was not found`, { templateId });
  return template;
}

function createCat(world, command) {
  assertId(command.catId, "catId"); assertId(command.drawingId, "drawingId"); assertId(command.attachmentSurfaceId, "attachmentSurfaceId");
  const template = requireTemplate(world, command.templateId);
  const drawing = world.drawings[command.drawingId];
  if (!drawing) throw fail("DRAWING_NOT_FOUND", "Cat drawing was not found", { drawingId: command.drawingId });
  if (Math.abs(drawing.width - template.viewBox.width) > world.rules.geometryEpsilon || Math.abs(drawing.height - template.viewBox.height) > world.rules.geometryEpsilon) throw fail("INVALID_TEMPLATE", "Cat drawing must use template dimensions", { drawingId: drawing.id, templateId: template.templateId });
  const transform = command.transform ?? command.worldTransform;
  const entity = { id: command.catId, kind: "cat", label: command.label ?? "Кот", templateId: command.templateId, drawingId: command.drawingId, attachmentSurfaceId: command.attachmentSurfaceId, width: template.viewBox.width, height: template.viewBox.height, surfaceId: command.targetSurfaceId ?? world.table.surfaceId, transform, zIndex: command.zIndex ?? nextZIndex(world, command.targetSurfaceId ?? world.table.surfaceId) };
  const v = template.viewBox;
  const attachmentSurface = { id: command.attachmentSurfaceId, kind: "cat-attachments", hostEntityId: command.catId, transform: { x: 0, y: 0, rotation: 0, scale: 1 }, placementArea: [{ x: v.x, y: v.y }, { x: v.x + v.width, y: v.y }, { x: v.x + v.width, y: v.y + v.height }, { x: v.x, y: v.y + v.height }], localVisibility: "visible" };
  const made = createEntity(world, { entity, surfaces: [attachmentSurface] });
  return { world: made.world, events: [...made.events, { type: "catCreated", catId: command.catId }] };
}

function chooseWearableZone(world, template, contour) {
  const epsilon = world.rules.geometryEpsilon;
  const ranked = Object.values(template.zones).map((zone) => ({ zone, area: zone.polygons.reduce((sum, polygon) => sum + polygonIntersectionArea(contour, polygon, epsilon), 0) }))
    .filter(({ area }) => area > epsilon)
    .sort((a, b) => Math.abs(b.area - a.area) > epsilon ? b.area - a.area : a.zone.tiePriority - b.zone.tiePriority || a.zone.zoneId.localeCompare(b.zone.zoneId));
  if (!ranked.length) throw fail("WEARABLE_ZONE_NOT_FOUND", "Wearable does not intersect a template zone");
  return ranked[0].zone;
}

function createWearableCutout(world, command) {
  const template = requireTemplate(world, command.templateId);
  const close = normalizeClosedContour(command.contour, command.closeDistance ?? world.rules.contourCloseDistance, world.rules.geometryEpsilon);
  if (!close.ok) throw fail(close.code, "Contour is invalid");
  const templateClose = command.templateContour ? normalizeClosedContour(command.templateContour, command.closeDistance ?? world.rules.contourCloseDistance, world.rules.geometryEpsilon) : close;
  if (!templateClose.ok) throw fail(templateClose.code, "Template contour is invalid");
  const zone = chooseWearableZone(world, template, templateClose.contour);
  const anchor = polygonCentroid(templateClose.contour, world.rules.geometryEpsilon);
  const made = createCutout(world, { ...command, type: "createCutout" });
  const entity = made.world.entities[command.entityId];
  const templateTransform = command.templateTransform ?? { x: anchor.x, y: anchor.y, rotation: 0, scale: 1 };
  assertTransform(world, templateTransform);
  const wearable = { ...entity, wearable: { templateId: command.templateId, zoneId: zone.zoneId, templateTransform: cloneTransform(templateTransform) }, attachment: null };
  return { world: { ...made.world, entities: { ...made.world.entities, [entity.id]: wearable } }, events: [...made.events, { type: "wearableCreated", wearableId: entity.id, zoneId: zone.zoneId }] };
}

function attachWearable(world, command) {
  const wearable = requireEntity(world, command.wearableId), cat = requireEntity(world, command.catId);
  if (!wearable.wearable) throw fail("NOT_WEARABLE", "Entity is not wearable", { entityId: wearable.id });
  if (cat.kind !== "cat") throw fail("NOT_A_CAT", "Entity is not a cat", { entityId: cat.id });
  if (wearable.attachment) throw fail(wearable.attachment.catId === cat.id ? "ALREADY_ATTACHED" : "ENTITY_ATTACHED", "Wearable is already attached");
  if (wearable.wearable.templateId !== cat.templateId) throw fail("INCOMPATIBLE_TEMPLATE", "Wearable and cat templates differ");
  if (!isEntityVisibleQuery(world, wearable.id) || !isEntityVisibleQuery(world, cat.id)) throw fail("TARGET_NOT_VISIBLE", "Wearable and cat must be visible");
  const template = requireTemplate(world, cat.templateId), zone = template.zones[wearable.wearable.zoneId];
  if (!zone) throw fail("WEARABLE_ZONE_NOT_FOUND", "Wearable zone was not found");
  const zIndex = nextZIndex(world, cat.attachmentSurfaceId);
  const fromWorldTransform = getEntityWorldTransformQuery(world, wearable.id);
  const updated = { ...wearable, surfaceId: cat.attachmentSurfaceId, transform: cloneTransform(wearable.wearable.templateTransform), zIndex, attachment: { catId: cat.id, zoneId: zone.zoneId } };
  return { world: { ...world, entities: { ...world.entities, [wearable.id]: updated } }, events: [{ type: "wearableAttached", wearableId: wearable.id, catId: cat.id, zoneId: zone.zoneId, fromWorldTransform }] };
}

function detachWearable(world, command) {
  const wearable = requireEntity(world, command.wearableId);
  if (!wearable.wearable) throw fail("NOT_WEARABLE", "Entity is not wearable");
  if (!wearable.attachment) throw fail("INVALID_ATTACHMENT", "Wearable is not attached");
  const pose = command.worldTransform ?? command.transform ?? getEntityWorldTransformQuery(world, wearable.id);
  const targetSurfaceId = command.targetSurfaceId;
  assertTransform(world, pose);
  const inverse = invertMatrix(getSurfaceWorldMatrixQuery(world, targetSurfaceId), world.rules.geometryEpsilon);
  const local = inverse && decomposeMatrix(multiplyMatrices(inverse, matrixFromTransform(pose)), world.rules.geometryEpsilon);
  if (!local) throw fail("INVALID_TRANSFORM", "World transform cannot be represented locally");
  const moved = movedWorld(world, wearable, targetSurfaceId, local, command.zPolicy ?? "front");
  const updated = { ...moved.entities[wearable.id], attachment: null };
  return { world: { ...moved, entities: { ...moved.entities, [wearable.id]: updated } }, events: [{ type: "wearableDetached", wearableId: wearable.id, catId: wearable.attachment.catId }] };
}

function holdEntity(world, command) {
  const entity = requireEntity(world, command.entityId), cat = requireEntity(world, command.catId);
  if (cat.kind !== "cat") throw fail("NOT_A_CAT", "Entity is not a cat", { entityId: cat.id });
  if (entity.id === cat.id || entity.attachment) throw fail("INVALID_ATTACHMENT", "Entity cannot be held", { entityId: entity.id });
  if (!isEntityVisibleQuery(world, entity.id) || !isEntityVisibleQuery(world, cat.id)) throw fail("TARGET_NOT_VISIBLE", "Entity and cat must be visible");
  const pose = command.worldTransform ?? getEntityWorldTransformQuery(world, entity.id), inverse = invertMatrix(getSurfaceWorldMatrixQuery(world, cat.attachmentSurfaceId), world.rules.geometryEpsilon);
  const localPose = inverse && decomposeMatrix(multiplyMatrices(inverse, matrixFromTransform(pose)), world.rules.geometryEpsilon);
  const template = world.rules.templates[cat.templateId], held = entity.item === true;
  const local = localPose && (held ? { ...localPose, x: template.viewBox.x + template.viewBox.width * .5, y: template.viewBox.y + template.viewBox.height * .72, scale: Math.min(localPose.scale, .65) } : localPose);
  if (!local) throw fail("INVALID_TRANSFORM", "Held transform cannot be represented locally");
  requireSurface(world, cat.attachmentSurfaceId);
  const attachment = held ? { kind: "held", catId: cat.id, zoneId: "paws", worldScaleBeforeHold: command.worldScaleBeforeHold ?? pose.scale } : { kind: "carried", catId: cat.id };
  const updated = { ...entity, surfaceId: cat.attachmentSurfaceId, transform: cloneTransform(local), zIndex: nextZIndex(world, cat.attachmentSurfaceId), attachment };
  return { world: { ...world, entities: { ...world.entities, [entity.id]: updated } }, events: [{ type: "entityHeld", entityId: entity.id, catId: cat.id }] };
}

function releaseHeldEntity(world, command) {
  const entity = requireEntity(world, command.entityId);
  if (!['held', 'carried'].includes(entity.attachment?.kind)) throw fail("INVALID_ATTACHMENT", "Entity is not attached to a cat", { entityId: entity.id });
  const currentPose = command.worldTransform ?? getEntityWorldTransformQuery(world, entity.id), pose = entity.attachment.kind === "held" ? { ...currentPose, scale: entity.attachment.worldScaleBeforeHold } : currentPose, targetSurfaceId = command.targetSurfaceId;
  const inverse = invertMatrix(getSurfaceWorldMatrixQuery(world, targetSurfaceId), world.rules.geometryEpsilon), local = inverse && decomposeMatrix(multiplyMatrices(inverse, matrixFromTransform(pose)), world.rules.geometryEpsilon);
  if (!local) throw fail("INVALID_TRANSFORM", "Released transform cannot be represented locally");
  const released = { ...entity, attachment: null }, moved = movedWorld({ ...world, entities: { ...world.entities, [entity.id]: released } }, released, targetSurfaceId, local, command.zPolicy ?? "front");
  return { world: moved, events: [{ type: "entityReleased", entityId: entity.id, catId: entity.attachment.catId }] };
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
  if (Object.values(world.entities).some((e) => e.drawingId === drawing.id) || Object.values(world.surfaces).some((s) => s.drawingId === drawing.id)) throw fail("DRAWING_IN_USE", "Drawing is referenced", { drawingId: drawing.id });
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
  const entity = { id: entityId, kind: "cutout", item: true, label: command.label ?? "Вырезка", drawingId, contour: shifted, anchor: { x: 0, y: 0 }, width: drawing.width, height: drawing.height, surfaceId, transform: { x: position.x, y: position.y, rotation: 0, scale: 1 }, zIndex: nextZIndex(world, surfaceId) };
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
  if (command.type === "createCat") return createCat(world, command);
  if (command.type === "createWearableCutout") return createWearableCutout(world, command);
  if (command.type === "attachWearable") return attachWearable(world, command);
  if (command.type === "detachWearable") return detachWearable(world, command);
  if (command.type === "holdEntity") return holdEntity(world, command);
  if (command.type === "releaseHeldEntity") return releaseHeldEntity(world, command);
  if (command.type === "createSheet") return createSheet(world, command);
  if (command.type === "setSheetState") return setSheetState(world, command);
  if (command.type === "toggleSheet") { const sheet = requireEntity(world, command.sheetId ?? command.entityId); if (sheet.kind !== "sheet") throw fail("NOT_A_SHEET", "Entity is not a sheet"); return setSheetState(world, { ...command, state: sheet.state === "open" ? "closed" : "open" }); }
  if (command.type === "createNotebook") return createNotebook(world, command);
  if (command.type === "setNotebookState") return setNotebookState(world, command);
  if (command.type === "setActiveSpread") return setActiveSpread(world, command);
  if (command.type === "setSurfaceVisibility") {
    const surface = requireSurface(world, command.surfaceId);
    if (surface.kind !== "generic") throw fail("INVALID_REFERENCE", "Only generic surfaces can change visibility", { surfaceId: surface.id });
    if (command.visibility !== "visible" && command.visibility !== "hidden") throw fail("INVALID_REFERENCE", "Invalid visibility", { visibility: command.visibility });
    return { world: { ...world, surfaces: { ...world.surfaces, [surface.id]: { ...surface, localVisibility: command.visibility } } }, events: [{ type: "surfaceVisibilityChanged", surfaceId: surface.id, visibility: command.visibility }] };
  }
  const entity = requireEntity(world, command.entityId);
  if (entity.attachment && command.type !== "bringEntityToFront") throw fail("ENTITY_ATTACHED", "Detach or release entity before moving it", { entityId: entity.id });
  if (command.type === "bringEntityToFront") {
    const siblings = Object.values(world.entities).filter((candidate) => candidate.surfaceId === entity.surfaceId && (!entity.attachment || candidate.attachment?.zoneId === entity.attachment.zoneId));
    const zIndex = siblings.length ? Math.max(...siblings.map((candidate) => candidate.zIndex)) + 1 : 0;
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
