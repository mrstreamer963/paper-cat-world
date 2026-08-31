import { createWorldModel } from "./model/world.js";
import { applyWorldCommand } from "./commands/index.js";
import { validateWorldState } from "./validate.js";
import { getEntityWorldTransformQuery, getSurfaceWorldMatrixQuery, isEntityVisibleQuery } from "./queries.js";

export const createWorld = createWorldModel;
export const applyCommand = applyWorldCommand;
export const validateWorld = validateWorldState;
export const getEntityWorldTransform = getEntityWorldTransformQuery;
export const getSurfaceWorldMatrix = getSurfaceWorldMatrixQuery;
export const isEntityVisible = isEntityVisibleQuery;

export * from "./geometry/matrix.js";
export * from "./geometry/polygon.js";
export * from "./history.js";
