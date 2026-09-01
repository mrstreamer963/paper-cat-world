import { fail } from "./errors.js";
import { createWorldModel } from "./model/world.js";
import { validateWorldState } from "./validate.js";

export const SAVE_FORMAT = "paper-cat-world";
export const SAVE_SCHEMA_VERSION = 1;
export const migrations = Object.freeze({});

const errorResult = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function cloneJsonValue(value, path = "save", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fail("INVALID_SAVE", "Save contains a non-finite number", { path });
    return value;
  }
  if (typeof value !== "object") throw fail("INVALID_SAVE", "Save contains a non-JSON value", { path });
  if (seen.has(value)) throw fail("INVALID_SAVE", "Save contains a cycle", { path });
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item, index) => cloneJsonValue(item, `${path}.${index}`, seen));
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw fail("INVALID_SAVE", "Save must contain plain objects", { path });
    result = {};
    for (const key of Object.keys(value).sort()) result[key] = cloneJsonValue(value[key], `${path}.${key}`, seen);
  }
  seen.delete(value);
  return result;
}

function sortedDictionary(input) {
  const output = {};
  for (const id of Object.keys(input).sort()) output[id] = cloneJsonValue(input[id], id);
  return output;
}

export function serializeWorld(world, metadata = {}) {
  const validation = validateWorldState(world);
  if (!validation.ok) throw fail("INVALID_SAVE", "World is not valid and cannot be saved", { errors: validation.errors });
  const safeMetadata = {};
  if (metadata.title !== undefined) {
    if (typeof metadata.title !== "string") throw fail("INVALID_SAVE", "metadata.title must be a string", { path: "metadata.title" });
    safeMetadata.title = metadata.title;
  }
  return {
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    metadata: safeMetadata,
    world: {
      table: cloneJsonValue(world.table, "world.table"),
      entities: sortedDictionary(world.entities),
      surfaces: sortedDictionary(world.surfaces),
      drawings: sortedDictionary(world.drawings),
    },
  };
}

export function loadWorld(input, config = {}) {
  let envelope;
  try { envelope = typeof input === "string" ? JSON.parse(input) : cloneJsonValue(input); }
  catch (error) {
    if (error?.code === "INVALID_SAVE") return errorResult(error.code, error.message, error.details);
    return errorResult("INVALID_JSON", "The file is not valid JSON", { message: error?.message });
  }
  if (!isRecord(envelope)) return errorResult("INVALID_FORMAT", "Save envelope must be an object");
  if (envelope.format !== SAVE_FORMAT) return errorResult("INVALID_FORMAT", "Unknown save format", { format: envelope.format });
  if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) return errorResult("INVALID_SCHEMA_VERSION", "schemaVersion must be a positive integer", { schemaVersion: envelope.schemaVersion });
  if (envelope.schemaVersion > SAVE_SCHEMA_VERSION) return errorResult("UNSUPPORTED_SCHEMA_VERSION", "This save was created by a newer version", { schemaVersion: envelope.schemaVersion, supported: SAVE_SCHEMA_VERSION });
  let migrated = envelope;
  try {
    for (let version = envelope.schemaVersion; version < SAVE_SCHEMA_VERSION; version += 1) {
      if (typeof migrations[version] !== "function") return errorResult("MIGRATION_FAILED", "No migration is available", { fromVersion: version });
      migrated = migrations[version](cloneJsonValue(migrated));
    }
  } catch (error) { return errorResult("MIGRATION_FAILED", "Save migration failed", { message: error?.message }); }
  if (!isRecord(migrated.world) || !isRecord(migrated.world.table) || !isRecord(migrated.world.entities) || !isRecord(migrated.world.surfaces) || !isRecord(migrated.world.drawings)) return errorResult("INVALID_SAVE", "Save world has an invalid structure", { path: "world" });
  let base;
  try { base = createWorldModel({ ...config, table: migrated.world.table }); }
  catch (error) { return errorResult("INVALID_SAVE", "Save table is invalid", { cause: error?.code, ...error?.details }); }
  const world = { rules: base.rules, table: migrated.world.table, entities: migrated.world.entities, surfaces: migrated.world.surfaces, drawings: migrated.world.drawings };
  const missingTemplate = Object.values(world.entities).find((entity) => entity?.templateId && !world.rules.templates[entity.templateId])?.templateId
    ?? Object.values(world.entities).find((entity) => entity?.wearable?.templateId && !world.rules.templates[entity.wearable.templateId])?.wearable?.templateId;
  if (missingTemplate) return errorResult("MISSING_TEMPLATE", "A required template is not available", { templateId: missingTemplate });
  const validation = validateWorldState(world);
  if (!validation.ok) return errorResult("INVALID_SAVE", "Saved world failed validation", { errors: validation.errors, path: validation.errors[0]?.path });
  if (migrated.metadata !== undefined && (!isRecord(migrated.metadata) || (migrated.metadata.title !== undefined && typeof migrated.metadata.title !== "string"))) return errorResult("INVALID_SAVE", "Save metadata has an invalid structure", { path: "metadata" });
  const metadata = migrated.metadata?.title === undefined ? {} : { title: migrated.metadata.title };
  return { ok: true, world, metadata, warnings: [] };
}
