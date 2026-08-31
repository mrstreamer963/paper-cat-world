import { isConvexPolygon, isFinitePoint, isSimplePolygon, pointInPolygon } from "./geometry/polygon.js";

const add = (errors, code, path, details = {}) => errors.push({ code, path, details });
const validId = (value) => typeof value === "string" && value.length > 0;
const CAT_ZONE_IDS = new Set(["head", "face", "body", "paws", "back"]);

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
  if (!Number.isFinite(rules.contourCloseDistance) || rules.contourCloseDistance <= 0) add(errors, "INVALID_NUMBER", "rules.contourCloseDistance", { value: rules.contourCloseDistance });
  if (!Number.isFinite(rules.minCutoutArea) || rules.minCutoutArea <= 0) add(errors, "INVALID_NUMBER", "rules.minCutoutArea", { value: rules.minCutoutArea });
  if (!Number.isInteger(rules.historyLimit) || rules.historyLimit <= 0) add(errors, "INVALID_NUMBER", "rules.historyLimit", { value: rules.historyLimit });
  const epsilon = Number.isFinite(rules.geometryEpsilon) ? rules.geometryEpsilon : 1e-9;
  const entities = world.entities && typeof world.entities === "object" ? world.entities : {};
  const surfaces = world.surfaces && typeof world.surfaces === "object" ? world.surfaces : {};
  const drawings = world.drawings && typeof world.drawings === "object" ? world.drawings : {};
  const templates = rules.templates && typeof rules.templates === "object" ? rules.templates : {};
  if (entities !== world.entities) add(errors, "INVALID_REFERENCE", "entities");
  if (surfaces !== world.surfaces) add(errors, "INVALID_REFERENCE", "surfaces");
  if (drawings !== world.drawings) add(errors, "INVALID_REFERENCE", "drawings");
  if (templates !== rules.templates) add(errors, "INVALID_TEMPLATE", "rules.templates");

  for (const [templateId, template] of Object.entries(templates)) {
    const path = `rules.templates.${templateId}`;
    if (!template || template.templateId !== templateId || !template.viewBox || !Number.isFinite(template.viewBox.x) || !Number.isFinite(template.viewBox.y) || !Number.isFinite(template.viewBox.width) || template.viewBox.width <= 0 || !Number.isFinite(template.viewBox.height) || template.viewBox.height <= 0 || !isSimplePolygon(template.silhouette, epsilon) || !template.zones || typeof template.zones !== "object" || Object.keys(template.zones).length === 0) { add(errors, "INVALID_TEMPLATE", path); continue; }
    if ([...CAT_ZONE_IDS].some((zoneId) => !template.zones[zoneId]) || Object.keys(template.zones).some((zoneId) => !CAT_ZONE_IDS.has(zoneId))) add(errors, "INVALID_TEMPLATE", `${path}.zones`);
    for (const [zoneId, zone] of Object.entries(template.zones)) if (!zone || zone.zoneId !== zoneId || !Number.isFinite(zone.layer) || !Number.isFinite(zone.tiePriority) || !Array.isArray(zone.polygons) || zone.polygons.length === 0 || zone.polygons.some((polygon) => !isConvexPolygon(polygon, epsilon))) add(errors, "INVALID_TEMPLATE", `${path}.zones.${zoneId}`);
  }

  for (const [key, drawing] of Object.entries(drawings)) {
    const path = `drawings.${key}`;
    if (!drawing || drawing.id !== key || !validId(drawing.id)) { add(errors, "INVALID_REFERENCE", `${path}.id`); continue; }
    if (!Number.isFinite(drawing.width) || drawing.width <= 0 || !Number.isFinite(drawing.height) || drawing.height <= 0) add(errors, "INVALID_NUMBER", path);
    if (!Number.isInteger(drawing.revision) || drawing.revision < 0) add(errors, "INVALID_NUMBER", `${path}.revision`);
    if (!Array.isArray(drawing.strokes)) { add(errors, "INVALID_STROKE", `${path}.strokes`); continue; }
    const strokeIds = new Set();
    for (const [i, stroke] of drawing.strokes.entries()) {
      if (!stroke || !validId(stroke.id) || strokeIds.has(stroke.id) || !["brush", "eraser"].includes(stroke.tool) || !Number.isFinite(stroke.width) || stroke.width <= 0 || !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.some((p) => !isFinitePoint(p) || !Number.isFinite(p.pressure) || p.pressure < 0 || p.pressure > 1)) add(errors, "INVALID_STROKE", `${path}.strokes.${i}`);
      strokeIds.add(stroke?.id);
    }
  }

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
    if (entity.kind === "cutout") {
      if (!drawings[entity.drawingId]) add(errors, "DRAWING_NOT_FOUND", `${path}.drawingId`);
      if (!isFinitePoint(entity.anchor) || !isSimplePolygon(entity.contour, epsilon)) add(errors, "INVALID_CONTOUR", `${path}.contour`);
    }
    if (entity.kind === "cat") {
      if (!templates[entity.templateId]) add(errors, "TEMPLATE_NOT_FOUND", `${path}.templateId`);
      if (!drawings[entity.drawingId]) add(errors, "DRAWING_NOT_FOUND", `${path}.drawingId`);
      else if (templates[entity.templateId] && (Math.abs(drawings[entity.drawingId].width - templates[entity.templateId].viewBox.width) > epsilon || Math.abs(drawings[entity.drawingId].height - templates[entity.templateId].viewBox.height) > epsilon)) add(errors, "INVALID_TEMPLATE", `${path}.drawingId`);
      const attachmentSurface = surfaces[entity.attachmentSurfaceId];
      if (!attachmentSurface || attachmentSurface.kind !== "cat-attachments" || attachmentSurface.hostEntityId !== entity.id) add(errors, "INVALID_ATTACHMENT", `${path}.attachmentSurfaceId`);
    }
    if (entity.wearable) {
      const template = templates[entity.wearable.templateId], zone = template?.zones?.[entity.wearable.zoneId];
      if (!template) add(errors, "TEMPLATE_NOT_FOUND", `${path}.wearable.templateId`);
      else if (!zone) add(errors, "WEARABLE_ZONE_NOT_FOUND", `${path}.wearable.zoneId`);
      validateTransform(entity.wearable.templateTransform, rules, `${path}.wearable.templateTransform`, errors);
      if (entity.attachment) {
        const cat = entities[entity.attachment.catId];
        if (!cat || cat.kind !== "cat" || cat.templateId !== entity.wearable.templateId || entity.attachment.zoneId !== entity.wearable.zoneId || entity.surfaceId !== cat?.attachmentSurfaceId) add(errors, "INVALID_ATTACHMENT", `${path}.attachment`);
      } else if (surfaces[entity.surfaceId]?.kind === "cat-attachments") add(errors, "INVALID_ATTACHMENT", `${path}.surfaceId`);
    }
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
    } else if (surface.kind !== "generic" && surface.kind !== "cat-attachments") add(errors, "INVALID_REFERENCE", `${path}.kind`, { kind: surface.kind });
    if (surface.kind === "cat-attachments") {
      const host = entities[surface.hostEntityId];
      if (!host || host.kind !== "cat" || host.attachmentSurfaceId !== surface.id) add(errors, "INVALID_ATTACHMENT", path);
      for (const child of Object.values(entities).filter((entity) => entity.surfaceId === surface.id)) if (!child.wearable || child.attachment?.catId !== host?.id) add(errors, "INVALID_ATTACHMENT", `entities.${child.id}.surfaceId`);
    }
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
