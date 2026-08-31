import { fail } from "./errors.js";
import { identityMatrix, matrixFromTransform, multiplyMatrices, decomposeMatrix } from "./geometry/matrix.js";

function buildWorldMatrix(world, startType, startId) {
  const chain = [];
  const visited = new Set();
  let type = startType;
  let id = startId;
  while (id !== null) {
    const key = `${type}:${id}`;
    if (visited.has(key)) throw fail("CYCLE_DETECTED", "Cycle encountered while resolving world matrix", { id, type });
    visited.add(key);
    if (type === "entity") {
      const entity = world.entities[id];
      if (!entity) throw fail("ENTITY_NOT_FOUND", `Entity ${id} was not found`, { entityId: id });
      chain.push(entity.transform);
      type = "surface";
      id = entity.surfaceId;
    } else {
      const surface = world.surfaces[id];
      if (!surface) throw fail("SURFACE_NOT_FOUND", `Surface ${id} was not found`, { surfaceId: id });
      chain.push(surface.transform);
      type = "entity";
      id = surface.hostEntityId;
    }
  }
  let matrix = identityMatrix();
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    matrix = multiplyMatrices(matrix, matrixFromTransform(chain[index]));
  }
  return matrix;
}

export const getSurfaceWorldMatrixQuery = (world, surfaceId) => buildWorldMatrix(world, "surface", surfaceId);

export function getEntityWorldTransformQuery(world, entityId) {
  const matrix = buildWorldMatrix(world, "entity", entityId);
  const transform = decomposeMatrix(matrix, world.rules.geometryEpsilon);
  if (!transform) throw fail("INVALID_TRANSFORM", "Entity world matrix cannot be decomposed", { entityId });
  return { ...transform };
}

export function isEntityVisibleQuery(world, entityId) {
  const entity = world.entities[entityId];
  if (!entity) throw fail("ENTITY_NOT_FOUND", `Entity ${entityId} was not found`, { entityId });
  const visited = new Set();
  let surfaceId = entity.surfaceId;
  while (surfaceId !== null) {
    if (visited.has(surfaceId)) throw fail("CYCLE_DETECTED", "Cycle encountered while resolving visibility", { surfaceId });
    visited.add(surfaceId);
    const surface = world.surfaces[surfaceId];
    if (!surface) throw fail("SURFACE_NOT_FOUND", `Surface ${surfaceId} was not found`, { surfaceId });
    if (surface.localVisibility === "hidden") return false;
    if (surface.hostEntityId === null) return true;
    const host = world.entities[surface.hostEntityId];
    if (!host) throw fail("ENTITY_NOT_FOUND", `Entity ${surface.hostEntityId} was not found`, { entityId: surface.hostEntityId });
    surfaceId = host.surfaceId;
  }
  return true;
}

export function isSurfaceVisible(world, surfaceId) {
  const surface = world.surfaces[surfaceId];
  if (!surface) throw fail("SURFACE_NOT_FOUND", `Surface ${surfaceId} was not found`, { surfaceId });
  if (surface.localVisibility === "hidden") return false;
  return surface.hostEntityId === null || isEntityVisibleQuery(world, surface.hostEntityId);
}
