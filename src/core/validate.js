import { isSimplePolygon, pointInPolygon } from "./geometry/polygon.js";

const add = (errors, code, path, details = {}) => errors.push({ code, path, details });
const validId = (value) => typeof value === "string" && value.length > 0;

function validateTransform(transform, rules, path, errors) {
  if (!transform || typeof transform !== "object") {
    add(errors, "INVALID_TRANSFORM", path);
    return;
  }
  for (const field of ["x", "y", "rotation", "scale"]) {
    if (!Number.isFinite(transform[field])) add(errors, "INVALID_NUMBER", `${path}.${field}`, { value: transform[field] });
  }
  if (Number.isFinite(transform.scale) && (transform.scale < rules.minScale || transform.scale > rules.maxScale)) {
    add(errors, "INVALID_TRANSFORM", `${path}.scale`, { value: transform.scale });
  }
}

export function validateWorldState(world) {
  const errors = [];
  if (!world || typeof world !== "object") return { ok: false, errors: [{ code: "INVALID_REFERENCE", path: "world", details: {} }] };
  const rules = world.rules ?? {};
  if (!Number.isFinite(rules.geometryEpsilon) || rules.geometryEpsilon <= 0) add(errors, "INVALID_NUMBER", "rules.geometryEpsilon", { value: rules.geometryEpsilon });
  if (!Number.isFinite(rules.minScale) || rules.minScale <= 0) add(errors, "INVALID_NUMBER", "rules.minScale", { value: rules.minScale });
  if (!Number.isFinite(rules.maxScale) || rules.maxScale < rules.minScale) add(errors, "INVALID_NUMBER", "rules.maxScale", { value: rules.maxScale });
  const epsilon = Number.isFinite(rules.geometryEpsilon) ? rules.geometryEpsilon : 1e-9;
  const entities = world.entities && typeof world.entities === "object" ? world.entities : {};
  const surfaces = world.surfaces && typeof world.surfaces === "object" ? world.surfaces : {};
  if (entities !== world.entities) add(errors, "INVALID_REFERENCE", "entities");
  if (surfaces !== world.surfaces) add(errors, "INVALID_REFERENCE", "surfaces");

  const globalIds = new Set();
  for (const [key, entity] of Object.entries(entities)) {
    const path = `entities.${key}`;
    if (!entity || typeof entity !== "object") { add(errors, "INVALID_REFERENCE", path); continue; }
    if (!validId(entity.id) || entity.id !== key) add(errors, "INVALID_REFERENCE", `${path}.id`, { value: entity.id });
    if (globalIds.has(entity.id)) add(errors, "DUPLICATE_ID", `${path}.id`, { id: entity.id });
    globalIds.add(entity.id);
    if (!surfaces[entity.surfaceId]) add(errors, "INVALID_REFERENCE", `${path}.surfaceId`, { surfaceId: entity.surfaceId });
    validateTransform(entity.transform, rules, `${path}.transform`, errors);
    if (!Number.isFinite(entity.zIndex)) add(errors, "INVALID_NUMBER", `${path}.zIndex`, { value: entity.zIndex });
  }

  let rootCount = 0;
  for (const [key, surface] of Object.entries(surfaces)) {
    const path = `surfaces.${key}`;
    if (!surface || typeof surface !== "object") { add(errors, "INVALID_REFERENCE", path); continue; }
    if (!validId(surface.id) || surface.id !== key) add(errors, "INVALID_REFERENCE", `${path}.id`, { value: surface.id });
    if (globalIds.has(surface.id)) add(errors, "DUPLICATE_ID", `${path}.id`, { id: surface.id });
    globalIds.add(surface.id);
    if (surface.hostEntityId === null) rootCount += 1;
    else if (!entities[surface.hostEntityId]) add(errors, "INVALID_REFERENCE", `${path}.hostEntityId`, { hostEntityId: surface.hostEntityId });
    if (surface.kind === "table") {
      if (surface.hostEntityId !== null || surface.id !== world.table?.surfaceId) add(errors, "INVALID_REFERENCE", path, { reason: "invalid table surface" });
    } else if (surface.kind !== "generic") add(errors, "INVALID_REFERENCE", `${path}.kind`, { kind: surface.kind });
    validateTransform(surface.transform, rules, `${path}.transform`, errors);
    if (!isSimplePolygon(surface.placementArea, epsilon)) add(errors, "INVALID_POLYGON", `${path}.placementArea`);
    if (surface.localVisibility !== "visible" && surface.localVisibility !== "hidden") add(errors, "INVALID_REFERENCE", `${path}.localVisibility`, { value: surface.localVisibility });
  }
  if (rootCount !== 1 || !surfaces[world.table?.surfaceId]) add(errors, "INVALID_REFERENCE", "table.surfaceId", { rootCount });

  for (const [id, entity] of Object.entries(entities)) {
    const surface = surfaces[entity.surfaceId];
    if (surface && isSimplePolygon(surface.placementArea, epsilon) && entity.transform
      && Number.isFinite(entity.transform.x) && Number.isFinite(entity.transform.y)
      && !pointInPolygon({ x: entity.transform.x, y: entity.transform.y }, surface.placementArea, epsilon)) {
      add(errors, "OUTSIDE_PLACEMENT_AREA", `entities.${id}.transform`, { surfaceId: entity.surfaceId });
    }
  }

  for (const entityId of Object.keys(entities)) {
    const visited = new Set();
    let currentEntityId = entityId;
    while (currentEntityId !== null) {
      if (visited.has(currentEntityId)) { add(errors, "CYCLE_DETECTED", `entities.${entityId}.surfaceId`, { entityId: currentEntityId }); break; }
      visited.add(currentEntityId);
      const entity = entities[currentEntityId];
      const surface = entity && surfaces[entity.surfaceId];
      currentEntityId = surface?.hostEntityId ?? null;
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
