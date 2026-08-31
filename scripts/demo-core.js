import assert from "node:assert/strict";
import { applyCommand, createWorld, getEntityWorldTransform, validateWorld } from "../src/core/index.js";

const rectangle = (width, height) => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
const transform = (x, y, rotation = 0, scale = 1) => ({ x, y, rotation, scale });
let world = createWorld({ table: { width: 1000, height: 700, surfaceId: "desk" } });

function run(command) {
  const result = applyCommand(world, command);
  assert.equal(result.ok, true, result.error?.message);
  world = result.world;
}

run({ type: "createEntity", entity: { id: "outer", kind: "paper", surfaceId: "desk", transform: transform(200, 150, 0.2), zIndex: 0 }, surfaces: [
  { id: "outer-inside", kind: "generic", hostEntityId: "outer", transform: transform(10, 15), placementArea: rectangle(400, 300), localVisibility: "visible" },
] });
run({ type: "createEntity", entity: { id: "inner", kind: "paper", surfaceId: "desk", transform: transform(500, 250, -0.1), zIndex: 1 }, surfaces: [
  { id: "inner-inside", kind: "generic", hostEntityId: "inner", transform: transform(5, 5), placementArea: rectangle(250, 180), localVisibility: "visible" },
] });
run({ type: "createEntity", entity: { id: "figure", kind: "paper", surfaceId: "desk", transform: transform(550, 300, 0.4, 0.8), zIndex: 2 } });

const expectedPose = getEntityWorldTransform(world, "figure");
run({ type: "moveEntityInWorld", entityId: "inner", targetSurfaceId: "outer-inside", transform: getEntityWorldTransform(world, "inner"), zPolicy: "front" });
run({ type: "moveEntityInWorld", entityId: "figure", targetSurfaceId: "inner-inside", transform: expectedPose, zPolicy: "front" });
const actualPose = getEntityWorldTransform(world, "figure");
for (const field of ["x", "y", "rotation", "scale"]) assert.ok(Math.abs(actualPose[field] - expectedPose[field]) < 1e-8);
console.log("Figure world transform:", actualPose);

const cycle = applyCommand(world, { type: "moveEntity", entityId: "outer", targetSurfaceId: "inner-inside", transform: transform(20, 20) });
assert.equal(cycle.ok, false);
assert.equal(cycle.error.code, "CYCLE_DETECTED");
assert.equal(cycle.world, world);
console.log("Expected rejection:", cycle.error.code);
assert.deepEqual(validateWorld(world), { ok: true });
console.log("World validation: ok");
