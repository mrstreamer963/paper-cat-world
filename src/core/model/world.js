import { fail } from "../errors.js";
import { isConvexPolygon, isSimplePolygon } from "../geometry/polygon.js";

const DEFAULT_RULES = Object.freeze({ geometryEpsilon: 1e-9, minScale: 0.01, maxScale: 100, contourCloseDistance: 18, minCutoutArea: 64, historyLimit: 100 });
const CAT_ZONE_IDS = new Set(["head", "face", "body", "paws", "back"]);

function positiveFinite(value, fallback, name) {
  const normalized = value ?? fallback;
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw fail("INVALID_NUMBER", `${name} must be a positive finite number`, { name, value: normalized });
  }
  return normalized;
}
function positiveInteger(value, fallback, name) {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized <= 0) throw fail("INVALID_NUMBER", `${name} must be a positive integer`, { name, value: normalized });
  return normalized;
}

export function createWorldModel(config = {}) {
  const rulesConfig = config.rules ?? config;
  const templates = normalizeTemplates(config.templates ?? rulesConfig.templates ?? {}, rulesConfig.geometryEpsilon ?? DEFAULT_RULES.geometryEpsilon);
  const rules = {
    geometryEpsilon: positiveFinite(rulesConfig.geometryEpsilon, DEFAULT_RULES.geometryEpsilon, "geometryEpsilon"),
    minScale: positiveFinite(rulesConfig.minScale, DEFAULT_RULES.minScale, "minScale"),
    maxScale: positiveFinite(rulesConfig.maxScale, DEFAULT_RULES.maxScale, "maxScale"),
    contourCloseDistance: positiveFinite(rulesConfig.contourCloseDistance, DEFAULT_RULES.contourCloseDistance, "contourCloseDistance"),
    minCutoutArea: positiveFinite(rulesConfig.minCutoutArea, DEFAULT_RULES.minCutoutArea, "minCutoutArea"),
    historyLimit: positiveInteger(rulesConfig.historyLimit, DEFAULT_RULES.historyLimit, "historyLimit"),
    templates,
  };
  if (rules.minScale > rules.maxScale) {
    throw fail("INVALID_TRANSFORM", "minScale cannot exceed maxScale", { minScale: rules.minScale, maxScale: rules.maxScale });
  }
  const tableConfig = config.table ?? config;
  const width = positiveFinite(tableConfig.width, 1200, "table.width");
  const height = positiveFinite(tableConfig.height, 800, "table.height");
  const surfaceId = tableConfig.surfaceId ?? "table";
  if (typeof surfaceId !== "string" || surfaceId.length === 0) {
    throw fail("INVALID_REFERENCE", "table.surfaceId must be a non-empty string", { surfaceId });
  }
  return {
    rules,
    table: { width, height, surfaceId },
    entities: {},
    drawings: {},
    surfaces: {
      [surfaceId]: {
        id: surfaceId,
        kind: "table",
        hostEntityId: null,
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        placementArea: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
        localVisibility: "visible",
      },
    },
  };
}

function normalizeTemplates(input, epsilon) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("INVALID_TEMPLATE", "templates must be an object");
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const templateId = value?.templateId ?? value?.id ?? key;
    const viewBox = value?.viewBox;
    const rawZones = value?.zones;
    if (!templateId || templateId !== key || !viewBox || !Number.isFinite(viewBox.width) || viewBox.width <= 0 || !Number.isFinite(viewBox.height) || viewBox.height <= 0 || !rawZones || typeof rawZones !== "object") throw fail("INVALID_TEMPLATE", `Template ${key} is invalid`);
    const zones = {};
    const entries = Array.isArray(rawZones) ? rawZones.map((z) => [z?.zoneId ?? z?.id, z]) : Object.entries(rawZones);
    for (const [zoneId, zone] of entries) {
      const polygons = zone?.polygons ?? (zone?.points ? [zone.points] : []);
      if (!zoneId || !CAT_ZONE_IDS.has(zoneId) || zones[zoneId] || !Array.isArray(polygons) || polygons.length === 0 || polygons.some((p) => !isConvexPolygon(p, epsilon)) || !Number.isFinite(zone.layer) || !Number.isFinite(zone.tiePriority)) throw fail("INVALID_TEMPLATE", `Zone ${zoneId ?? "?"} is invalid`, { templateId, zoneId });
      zones[zoneId] = { zoneId, layer: zone.layer, tiePriority: zone.tiePriority, polygons: polygons.map((p) => p.map(({ x, y }) => ({ x, y }))) };
    }
    if ([...CAT_ZONE_IDS].some((zoneId) => !zones[zoneId]) || !Array.isArray(value.silhouette) || !isSimplePolygon(value.silhouette, epsilon)) throw fail("INVALID_TEMPLATE", `Template ${key} is empty or has an invalid silhouette`);
    result[key] = { templateId, viewBox: { x: viewBox.x ?? 0, y: viewBox.y ?? 0, width: viewBox.width, height: viewBox.height }, silhouette: value.silhouette.map((p) => ({ ...p })), zones };
  }
  return result;
}
