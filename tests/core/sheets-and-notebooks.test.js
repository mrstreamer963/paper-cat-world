import { describe, expect, it } from "vitest";
import { applyCommand, createHistory, createWorld, applyHistoryCommand, undo, redo, getEntityWorldTransform, isEntityVisible, isSurfaceVisible, validateWorld } from "../../src/core/index.js";

const t = (x, y, rotation = 0, scale = 1) => ({ x, y, rotation, scale });
const run = (world, command) => { const result = applyCommand(world, command); expect(result.ok, result.error?.code).toBe(true); return result.world; };
const sheet = (id, targetSurfaceId = "table", transform = t(20, 20)) => ({ type: "createSheet", sheetId: id, insideSurfaceId: `${id}-inside`, outerTopSurfaceId: `${id}-top`, outerBottomSurfaceId: `${id}-bottom`, insideDrawingId: `${id}-inside-art`, outerTopDrawingId: `${id}-top-art`, outerBottomDrawingId: `${id}-bottom-art`, targetSurfaceId, transform, width: 180, height: 120 });
const notebook = () => ({ type: "createNotebook", notebookId: "home", coverSurfaceId: "home-cover", coverDrawingId: "home-cover-art", spreads: [0, 1, 2].map((n) => ({ id: `spread-${n}`, surfaceId: `room-${n}`, drawingId: `room-${n}-art` })), targetSurfaceId: "table", transform: t(250, 100), width: 220, height: 150 });

describe("sheets and notebooks", () => {
  it("derives sheet visibility without deleting hidden contents", () => {
    let world = createWorld({ width: 600, height: 400 }); world = run(world, sheet("car"));
    expect(world.surfaces["car-inside"].placementArea[1].x).toBe(180); expect(world.surfaces["car-top"].placementArea[1].x).toBe(90); expect(world.surfaces["car-top"].transform.x).toBe(90);
    expect(world.drawings["car-inside-art"].width).toBe(180); expect(world.drawings["car-top-art"].width).toBe(90);
    expect(isSurfaceVisible(world, "car-top")).toBe(true); expect(isSurfaceVisible(world, "car-inside")).toBe(false); expect(isSurfaceVisible(world, "car-bottom")).toBe(false);
    world = run(world, { type: "setSheetState", sheetId: "car", state: "open" });
    expect(isSurfaceVisible(world, "car-inside")).toBe(true); expect(isSurfaceVisible(world, "car-top")).toBe(false);
    world = run(world, { type: "createEntity", entity: { id: "cargo", kind: "paper", surfaceId: "car-inside", transform: t(20, 20), zIndex: 0 } });
    world = run(world, { type: "toggleSheet", sheetId: "car" }); expect(isEntityVisible(world, "cargo")).toBe(false); expect(world.entities.cargo.surfaceId).toBe("car-inside");
  });

  it("preserves nested state and rejects cycles", () => {
    let world = createWorld({ width: 700, height: 500 }); world = run(world, sheet("outer")); world = run(world, { type: "toggleSheet", sheetId: "outer" }); world = run(world, sheet("inner", "outer-inside", t(30, 30)));
    world = run(world, { type: "toggleSheet", sheetId: "inner" }); world = run(world, { type: "toggleSheet", sheetId: "outer" });
    expect(world.entities.inner.state).toBe("open"); expect(isEntityVisible(world, "inner")).toBe(false);
    expect(applyCommand(world, { type: "moveEntity", entityId: "outer", targetSurfaceId: "inner-inside", transform: t(10, 10) }).error.code).toBe("TARGET_NOT_VISIBLE");
    world = run(world, { type: "toggleSheet", sheetId: "outer" });
    expect(applyCommand(world, { type: "moveEntity", entityId: "outer", targetSurfaceId: "inner-inside", transform: t(10, 10) }).error.code).toBe("CYCLE_DETECTED");
  });

  it("switches notebook spreads and supports undo/redo", () => {
    let world = createWorld({ width: 700, height: 500 }); world = run(world, notebook());
    expect(isSurfaceVisible(world, "home-cover")).toBe(true); expect(isSurfaceVisible(world, "room-0")).toBe(false);
    world = run(world, { type: "setNotebookState", notebookId: "home", state: "open" }); expect(isSurfaceVisible(world, "room-0")).toBe(true);
    let history = createHistory(world); let changed = applyHistoryCommand(history, { type: "setActiveSpread", notebookId: "home", activeSpreadIndex: 2 }); expect(changed.ok).toBe(true); history = changed.history;
    expect(isSurfaceVisible(history.world, "room-2")).toBe(true); expect(isSurfaceVisible(history.world, "room-0")).toBe(false);
    history = undo(history).history; expect(history.world.entities.home.activeSpreadIndex).toBe(0);
    history = redo(history).history; expect(history.world.entities.home.activeSpreadIndex).toBe(2);
  });

  it("moves an entire sheet tree while preserving relative world poses", () => {
    let world = createWorld({ width: 900, height: 600 }); world = run(world, sheet("outer", "table", t(100, 100))); world = run(world, { type: "toggleSheet", sheetId: "outer" }); world = run(world, sheet("inner", "outer-inside", t(35, 25)));
    const beforeOuter = getEntityWorldTransform(world, "outer"), beforeInner = getEntityWorldTransform(world, "inner"); world = run(world, { type: "moveEntityInWorld", entityId: "outer", targetSurfaceId: "table", transform: t(300, 250, .2), zPolicy: "front" });
    const afterOuter = getEntityWorldTransform(world, "outer"), afterInner = getEntityWorldTransform(world, "inner"); expect(afterInner.x - afterOuter.x).not.toBeCloseTo(beforeInner.x - beforeOuter.x); expect(world.entities.inner.surfaceId).toBe("outer-inside"); expect(validateWorld(world)).toEqual({ ok: true });
  });

  it("places a folded sheet by its visible half without changing the requested transform", () => {
    let world = createWorld({ width: 1400, height: 900 });
    const requested = t(-71.16822429906549, 477.5700934579439, -.04);
    world = run(world, sheet("created", "table", requested));
    expect(world.entities.created.transform).toEqual(requested);

    world = run(world, sheet("car", "table", t(505, 650, -.04)));

    world = run(world, { type: "moveEntityInWorld", entityId: "car", targetSurfaceId: "table", transform: requested, zPolicy: "front" });

    expect(world.entities.car.transform).toEqual(requested);
    expect(validateWorld(world)).toEqual({ ok: true });
  });

  it("validates every surface role, drawing reference and unique role link", () => {
    let world = createWorld({ width: 600, height: 400 }); world = run(world, sheet("valid"));
    const mismatched = { ...world, surfaces: { ...world.surfaces, "valid-inside": { ...world.surfaces["valid-inside"], kind: "sheet-outer-top" } } };
    expect(validateWorld(mismatched).errors.map((error) => error.code)).toContain("SURFACE_ROLE_MISMATCH");
    const missingDrawing = { ...world, drawings: { ...world.drawings } }; delete missingDrawing.drawings["valid-top-art"];
    expect(validateWorld(missingDrawing).errors.map((error) => error.code)).toContain("DRAWING_NOT_FOUND");
    const duplicateRole = { ...world, entities: { ...world.entities, valid: { ...world.entities.valid, outerBottomSurfaceId: "valid-top" } } };
    expect(validateWorld(duplicateRole).errors.map((error) => error.code)).toContain("INVALID_SHEET");
  });

  it("creates atomically and retains drawings and entities on hidden surfaces", () => {
    const empty = createWorld({ width: 600, height: 400 });
    const failed = applyCommand(empty, { ...sheet("broken"), outerTopDrawingId: "broken-inside-art" });
    expect(failed.ok).toBe(false); expect(failed.world).toBe(empty); expect(Object.keys(empty.drawings)).toHaveLength(0);
    let world = run(empty, sheet("box")); world = run(world, { type: "toggleSheet", sheetId: "box" });
    world = run(world, { type: "createEntity", entity: { id: "kept", kind: "paper", surfaceId: "box-inside", transform: t(30, 30), zIndex: 0 } });
    const drawing = world.drawings["box-inside-art"], kept = world.entities.kept; world = run(world, { type: "toggleSheet", sheetId: "box" });
    expect(world.drawings["box-inside-art"]).toBe(drawing); expect(world.entities.kept).toBe(kept);
    expect(applyCommand(world, { type: "deleteDrawing", drawingId: "box-inside-art" }).error.code).toBe("DRAWING_IN_USE");
  });

  it("rejects invalid spreads and interactions with hidden hosts", () => {
    let world = createWorld({ width: 900, height: 600 }); world = run(world, notebook());
    expect(applyCommand(world, { type: "setActiveSpread", notebookId: "home", activeSpreadIndex: 3 }).error.code).toBe("INVALID_SPREAD_INDEX");
    expect(applyCommand(world, { type: "setActiveSpread", notebookId: "home", activeSpreadIndex: 1 }).error.code).toBe("HOST_NOT_VISIBLE");
    world = run(world, sheet("outer", "table", t(30, 300))); world = run(world, { type: "toggleSheet", sheetId: "outer" });
    world = run(world, sheet("child", "outer-inside", t(20, 20))); world = run(world, { type: "toggleSheet", sheetId: "outer" });
    expect(applyCommand(world, { type: "toggleSheet", sheetId: "child" }).error.code).toBe("HOST_NOT_VISIBLE");
  });
});
