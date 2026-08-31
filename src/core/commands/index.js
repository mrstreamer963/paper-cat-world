import { fail, CoreError } from "../errors.js";
import { matrixFromTransform, invertMatrix, multiplyMatrices, decomposeMatrix } from "../geometry/matrix.js";
import { isSimplePolygon, pointInPolygon } from "../geometry/polygon.js";
import { getSurfaceWorldMatrixQuery, isSurfaceVisible } from "../queries.js";
import { validateWorldState } from "../validate.js";

const COMMANDS = new Set(["createEntity", "moveEntity", "moveEntityInWorld", "setEntityTransform", "bringEntityToFront", "setSurfaceVisibility"]);
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

function execute(world, command) {
  if (!command || typeof command !== "object" || !COMMANDS.has(command.type)) throw fail("UNKNOWN_COMMAND", "Unknown command", { type: command?.type });
  if (command.type === "createEntity") return createEntity(world, command);
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
