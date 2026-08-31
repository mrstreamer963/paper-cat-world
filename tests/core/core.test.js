import { describe, expect, it } from "vitest";
import { applyCommand, createWorld, getEntityWorldTransform, getSurfaceWorldMatrix, isEntityVisible, validateWorld } from "../../src/core/index.js";

const t = (x, y, rotation = 0, scale = 1) => ({ x, y, rotation, scale });
const rect = (width = 100, height = 100) => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
const entity = (id, surfaceId, transform = t(10, 10), zIndex = 0) => ({ id, kind: "paper", surfaceId, transform, zIndex });
const surface = (id, hostEntityId, transform = t(0, 0)) => ({ id, kind: "generic", hostEntityId, transform, placementArea: rect(), localVisibility: "visible" });

function succeed(world, command) {
  const result = applyCommand(world, command);
  expect(result.ok).toBe(true);
  return result.world;
}

function nestedWorld() {
  let world = createWorld({ table: { width: 500, height: 500, surfaceId: "table" } });
  world = succeed(world, { type: "createEntity", entity: entity("box", "table", t(100, 80, 0.2, 1.2)), surfaces: [surface("inside", "box", t(5, 7, -0.1, 0.8))] });
  world = succeed(world, { type: "createEntity", entity: entity("cat", "inside", t(20, 30, 0.3, 0.7)) });
  return world;
}

describe("world and commands", () => {
  it("creates a valid normalized table", () => {
    const world = createWorld({ width: 300, height: 200, surfaceId: "desk", geometryEpsilon: 1e-8 });
    expect(validateWorld(world)).toEqual({ ok: true });
    expect(world.rules.geometryEpsilon).toBe(1e-8);
    expect(getSurfaceWorldMatrix(world, "desk")).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("resolves a world pose through multiple levels", () => {
    const pose = getEntityWorldTransform(nestedWorld(), "cat");
    expect(pose.rotation).toBeCloseTo(0.4);
    expect(pose.scale).toBeCloseTo(0.672);
  });

  it("moves locally and preserves a requested world pose", () => {
    let world = nestedWorld();
    world = succeed(world, { type: "createEntity", entity: entity("target", "table", t(250, 100, -0.3, 1.1)), surfaces: [surface("target-inside", "target", t(2, 3))] });
    world = succeed(world, { type: "moveEntity", entityId: "cat", targetSurfaceId: "table", transform: t(50, 60), zPolicy: "front" });
    expect(world.entities.cat.surfaceId).toBe("table");
    const desired = t(280, 150, 0.5, 0.75);
    world = succeed(world, { type: "moveEntityInWorld", entityId: "cat", targetSurfaceId: "target-inside", transform: desired });
    expect(getEntityWorldTransform(world, "cat")).toEqual(expect.objectContaining({ x: expect.closeTo(280, 8), y: expect.closeTo(150, 8), rotation: expect.closeTo(0.5, 8), scale: expect.closeTo(0.75, 8) }));
  });

  it("propagates visibility and rejects hidden targets", () => {
    let world = nestedWorld();
    world = succeed(world, { type: "setSurfaceVisibility", surfaceId: "inside", visibility: "hidden" });
    expect(isEntityVisible(world, "cat")).toBe(false);
    const rejected = applyCommand(world, { type: "moveEntity", entityId: "cat", targetSurfaceId: "inside", transform: t(30, 30) });
    expect(rejected.error.code).toBe("TARGET_NOT_VISIBLE");
    expect(rejected.world).toBe(world);
  });

  it("rejects direct and indirect cycles atomically", () => {
    let world = nestedWorld();
    world = succeed(world, { type: "createEntity", entity: entity("small-box", "inside", t(40, 40)), surfaces: [surface("small-inside", "small-box")] });
    for (const targetSurfaceId of ["inside", "small-inside"]) {
      const result = applyCommand(world, { type: "moveEntity", entityId: "box", targetSurfaceId, transform: t(10, 10) });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("CYCLE_DETECTED");
      expect(result.world).toBe(world);
    }
  });

  it("returns stable errors for invalid data", () => {
    const world = createWorld({ width: 100, height: 100 });
    const cases = [
      [{ type: "wat" }, "UNKNOWN_COMMAND"],
      [{ type: "moveEntity", entityId: "missing", targetSurfaceId: "table", transform: t(1, 1) }, "ENTITY_NOT_FOUND"],
      [{ type: "createEntity", entity: entity("bad", "missing") }, "SURFACE_NOT_FOUND"],
      [{ type: "createEntity", entity: entity("bad", "table", t(Number.NaN, 1)) }, "INVALID_NUMBER"],
      [{ type: "createEntity", entity: entity("bad", "table", t(200, 1)) }, "OUTSIDE_PLACEMENT_AREA"],
    ];
    for (const [command, code] of cases) expect(applyCommand(world, command).error.code).toBe(code);
  });

  it("is deterministic, immutable and structurally shares unchanged records", () => {
    const world = nestedWorld();
    Object.freeze(world);
    Object.freeze(world.entities);
    Object.freeze(world.entities.cat);
    const command = { type: "setEntityTransform", entityId: "cat", transform: t(25, 35) };
    const first = applyCommand(world, command);
    const second = applyCommand(world, command);
    expect(first).toEqual(second);
    expect(first.world).not.toBe(world);
    expect(first.world.surfaces).toBe(world.surfaces);
    expect(first.world.entities.box).toBe(world.entities.box);
  });

  it("raises z-index only among siblings", () => {
    let world = nestedWorld();
    world = succeed(world, { type: "createEntity", entity: entity("peer", "inside", t(60, 60), 10) });
    world = succeed(world, { type: "bringEntityToFront", entityId: "cat" });
    expect(world.entities.cat.zIndex).toBe(11);
  });

  it("handles hundreds of nesting levels iteratively", () => {
    const depth = 250;
    const entities = {};
    const surfaces = {};
    const world = createWorld({ width: 10, height: 10 });
    Object.assign(surfaces, world.surfaces);
    let parentSurfaceId = "table";
    for (let index = 0; index < depth; index += 1) {
      const entityId = `box-${index}`;
      const surfaceId = `inside-${index}`;
      entities[entityId] = entity(entityId, parentSurfaceId, t(1, 1));
      surfaces[surfaceId] = { ...surface(surfaceId, entityId), placementArea: rect(10, 10) };
      parentSurfaceId = surfaceId;
    }
    entities.cat = entity("cat", parentSurfaceId, t(1, 1));
    const deepWorld = { ...world, entities, surfaces };
    expect(validateWorld(deepWorld)).toEqual({ ok: true });
    expect(isEntityVisible(deepWorld, "cat")).toBe(true);
    expect(getEntityWorldTransform(deepWorld, "cat").x).toBeCloseTo(depth + 1);
  });

  it("collects multiple validation failures", () => {
    const world = createWorld();
    const invalid = {
      ...world,
      rules: { ...world.rules, geometryEpsilon: 0 },
      entities: { broken: { ...entity("broken", "missing", t(Number.NaN, 0)), zIndex: Infinity } },
    };
    const result = validateWorld(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
    expect(result.errors.map(({ code }) => code)).toContain("INVALID_REFERENCE");
    expect(result.errors.map(({ code }) => code)).toContain("INVALID_NUMBER");
  });
});
