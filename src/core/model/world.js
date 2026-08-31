import { fail } from "../errors.js";

const DEFAULT_RULES = Object.freeze({ geometryEpsilon: 1e-9, minScale: 0.01, maxScale: 100, contourCloseDistance: 18, minCutoutArea: 64, historyLimit: 100 });

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
  const rules = {
    geometryEpsilon: positiveFinite(rulesConfig.geometryEpsilon, DEFAULT_RULES.geometryEpsilon, "geometryEpsilon"),
    minScale: positiveFinite(rulesConfig.minScale, DEFAULT_RULES.minScale, "minScale"),
    maxScale: positiveFinite(rulesConfig.maxScale, DEFAULT_RULES.maxScale, "maxScale"),
    contourCloseDistance: positiveFinite(rulesConfig.contourCloseDistance, DEFAULT_RULES.contourCloseDistance, "contourCloseDistance"),
    minCutoutArea: positiveFinite(rulesConfig.minCutoutArea, DEFAULT_RULES.minCutoutArea, "minCutoutArea"),
    historyLimit: positiveInteger(rulesConfig.historyLimit, DEFAULT_RULES.historyLimit, "historyLimit"),
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
