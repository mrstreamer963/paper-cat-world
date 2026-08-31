import { describe, expect, it } from "vitest";
import { applyCommand, applyHistoryCommand, applyHistoryGroup, createHistory, createWorld, getEntityWorldTransform, polygonIntersectionArea, redo, undo, validateWorld } from "../../src/core/index.js";

const transform = (x, y, rotation = 0, scale = 1) => ({ x, y, rotation, scale });
const rectangle = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const templates = { cat: { templateId: "cat", viewBox: { x: 0, y: 0, width: 200, height: 300 }, silhouette: rectangle(0, 0, 200, 300), zones: { head: { zoneId: "head", layer: 1, tiePriority: 0, polygons: [rectangle(0, 0, 200, 120)] }, face: { zoneId: "face", layer: 2, tiePriority: 5, polygons: [rectangle(80, 80, 40, 20)] }, body: { zoneId: "body", layer: 0, tiePriority: 1, polygons: [rectangle(0, 120, 200, 140)] }, paws: { zoneId: "paws", layer: 2, tiePriority: 3, polygons: [rectangle(0, 260, 200, 40)] }, back: { zoneId: "back", layer: -1, tiePriority: 4, polygons: [rectangle(0, 120, 200, 180)] } } } };
const drawing = (id) => ({ type: "createDrawing", drawing: { id, width: 200, height: 300, background: "transparent", strokes: [] } });
function dispatch(world, command) { const result = applyCommand(world, command); expect(result.ok, result.error?.code).toBe(true); return result.world; }

describe("cats and clothing", () => {
  it("measures polygon intersection and rejects invalid templates", () => {
    expect(polygonIntersectionArea(rectangle(0, 0, 10, 10), rectangle(5, 0, 10, 10))).toBeCloseTo(50);
    expect(() => createWorld({ templates: { bad: { templateId: "bad", viewBox: { width: 10, height: 10 }, silhouette: [], zones: {} } } })).toThrow();
  });

  it("creates cats, chooses a wearable zone, attaches and detaches with stable world pose", () => {
    let world = createWorld({ table: { width: 1000, height: 800 }, templates, minCutoutArea: 10 });
    world = dispatch(world, drawing("cat-a-art")); world = dispatch(world, drawing("cat-b-art")); world = dispatch(world, drawing("source"));
    world = dispatch(world, { type: "createCat", catId: "cat-a", drawingId: "cat-a-art", attachmentSurfaceId: "cat-a-wear", templateId: "cat", targetSurfaceId: "table", transform: transform(100, 100, .2, .8) });
    world = dispatch(world, { type: "createCat", catId: "cat-b", drawingId: "cat-b-art", attachmentSurfaceId: "cat-b-wear", templateId: "cat", targetSurfaceId: "table", transform: transform(600, 200, -.1, 1.2) });
    world = dispatch(world, { type: "createWearableCutout", entityId: "hat", newDrawingId: "hat-art", sourceDrawingId: "source", templateId: "cat", contour: [{ x: 10, y: 80 }, { x: 190, y: 80 }, { x: 160, y: 20 }, { x: 40, y: 20 }, { x: 10, y: 80 }], targetSurfaceId: "table", worldPosition: { x: 400, y: 400 } });
    expect(world.entities.hat.wearable.zoneId).toBe("head");
    world = dispatch(world, { type: "attachWearable", wearableId: "hat", catId: "cat-a" });
    expect(world.entities.hat.transform).toEqual(world.entities.hat.wearable.templateTransform);
    expect(applyCommand(world, { type: "moveEntity", entityId: "hat", targetSurfaceId: "table", transform: transform(1, 1) }).error.code).toBe("ENTITY_ATTACHED");
    const attachedPose = getEntityWorldTransform(world, "hat");
    world = dispatch(world, { type: "detachWearable", wearableId: "hat", targetSurfaceId: "table", worldTransform: attachedPose });
    expect(getEntityWorldTransform(world, "hat")).toEqual(expect.objectContaining({ x: expect.closeTo(attachedPose.x, 8), y: expect.closeTo(attachedPose.y, 8), rotation: expect.closeTo(attachedPose.rotation, 8), scale: expect.closeTo(attachedPose.scale, 8) }));
    world = dispatch(world, { type: "attachWearable", wearableId: "hat", catId: "cat-b" });
    expect(world.entities.hat.attachment.catId).toBe("cat-b");
    expect(applyCommand(world, { type: "deleteEntity", entityId: "cat-b" }).error.code).toBe("ENTITY_NOT_EMPTY");
    world = dispatch(world, { type: "setEntityTransform", entityId: "cat-b", transform: transform(620, 230, .4, .6) });
    const inherited = getEntityWorldTransform(world, "hat"); expect(inherited.rotation).toBeCloseTo(.4); expect(inherited.scale).toBeCloseTo(.6);
    expect(validateWorld(world)).toEqual({ ok: true });
  });

  it("uses tie priority and round-trips a composite transfer through history", () => {
    const tiedTemplates = structuredClone(templates); tiedTemplates.cat.zones.head.tiePriority = 2; tiedTemplates.cat.zones.body = { ...tiedTemplates.cat.zones.head, zoneId: "body", tiePriority: 1 };
    let world = createWorld({ table: { width: 1000, height: 800 }, templates: tiedTemplates, minCutoutArea: 10 });
    for (const id of ["a-art", "b-art", "source"]) world = dispatch(world, drawing(id));
    world = dispatch(world, { type: "createCat", catId: "a", drawingId: "a-art", attachmentSurfaceId: "a-wear", templateId: "cat", targetSurfaceId: "table", transform: transform(50, 50) });
    world = dispatch(world, { type: "createCat", catId: "b", drawingId: "b-art", attachmentSurfaceId: "b-wear", templateId: "cat", targetSurfaceId: "table", transform: transform(500, 50) });
    world = dispatch(world, { type: "createWearableCutout", entityId: "tie", newDrawingId: "tie-art", sourceDrawingId: "source", templateId: "cat", contour: [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 90 }, { x: 20, y: 90 }, { x: 20, y: 20 }], targetSurfaceId: "table", worldPosition: { x: 350, y: 350 } });
    expect(world.entities.tie.wearable.zoneId).toBe("body");
    let history = createHistory(world); let result = applyHistoryCommand(history, { type: "attachWearable", wearableId: "tie", catId: "a" }); history = result.history;
    const draggedPose = { ...getEntityWorldTransform(history.world, "tie"), x: 480, y: 80 };
    result = applyHistoryGroup(history, [{ type: "detachWearable", wearableId: "tie", targetSurfaceId: "table", worldTransform: draggedPose }, { type: "attachWearable", wearableId: "tie", catId: "b" }]); history = result.history;
    expect(history.world.entities.tie.attachment.catId).toBe("b");
    const undone = undo(history); expect(undone.world.entities.tie.attachment.catId).toBe("a");
    expect(redo(undone.history).world.entities.tie.attachment.catId).toBe("b");
  });

  it("detects corrupted template and attachment references", () => {
    let world = createWorld({ table: { width: 1000, height: 800 }, templates, minCutoutArea: 10 }); world = dispatch(world, drawing("cat-art")); world = dispatch(world, drawing("source"));
    world = dispatch(world, { type: "createCat", catId: "cat", drawingId: "cat-art", attachmentSurfaceId: "wear", templateId: "cat", targetSurfaceId: "table", transform: transform(100, 100) });
    world = dispatch(world, { type: "createWearableCutout", entityId: "hat", newDrawingId: "hat-art", sourceDrawingId: "source", templateId: "cat", contour: [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 80 }, { x: 20, y: 80 }, { x: 20, y: 20 }], targetSurfaceId: "table", worldPosition: { x: 400, y: 400 } });
    world = dispatch(world, { type: "attachWearable", wearableId: "hat", catId: "cat" });
    const badZone = structuredClone(world); badZone.entities.hat.wearable.zoneId = "missing"; expect(validateWorld(badZone).errors.map((error) => error.code)).toContain("WEARABLE_ZONE_NOT_FOUND");
    const badAttachment = structuredClone(world); badAttachment.entities.hat.attachment.catId = "missing"; expect(validateWorld(badAttachment).errors.map((error) => error.code)).toContain("INVALID_ATTACHMENT");
    const badTemplate = structuredClone(world); badTemplate.rules.templates.cat.zones.head.polygons[0][2] = { x: 20, y: 20 }; expect(validateWorld(badTemplate).errors.map((error) => error.code)).toContain("INVALID_TEMPLATE");
  });
});
