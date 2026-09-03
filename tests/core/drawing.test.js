import { describe, expect, it } from "vitest";
import { applyCommand, applyHistoryCommand, createHistory, createWorld, redo, undo } from "../../src/core/index.js";
import { DrawingTextureCache } from "../../src/render/drawing-texture-cache.js";

const drawing = { id: "art", width: 200, height: 150, background: "transparent", strokes: [] };
const stroke = { id: "s1", tool: "brush", color: "#123456", width: 10, points: [{ x: 20, y: 20, pressure: .5 }, { x: 80, y: 70, pressure: 1 }] };
const contour = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 100 }, { x: 10, y: 100 }, { x: 12, y: 11 }];
const importedImage = {
  id: "image-1",
  source: "data:image/png;base64,iVBORw0KGgo=",
  width: 64,
  height: 32,
  transform: { x: 45, y: 35, rotation: 0.2, scale: 0.75 },
};

function dispatch(world, command) { const result = applyCommand(world, command); expect(result.ok, result.error?.code).toBe(true); return result.world; }

describe("drawing, cutting and history", () => {
  it("commits immutable strokes and revisions", () => {
    const original = dispatch(createWorld(), { type: "createDrawing", drawing });
    const next = dispatch(original, { type: "addStroke", drawingId: "art", stroke });
    expect(original.drawings.art.strokes).toHaveLength(0);
    expect(next.drawings.art).toMatchObject({ revision: 1, strokes: [stroke] });
    expect(applyCommand(next, { type: "addStroke", drawingId: "art", stroke: { ...stroke, id: "bad", points: [{ x: 0, y: 0, pressure: 2 }] } }).error.code).toBe("INVALID_STROKE");
  });

  it("adds, transforms and removes imported images without changing their requested transform", () => {
    const original = dispatch(createWorld(), { type: "createDrawing", drawing });
    const added = dispatch(original, {
      type: "addDrawingImage",
      drawingId: "art",
      image: importedImage,
    });
    expect(original.drawings.art.images).toEqual([]);
    expect(added.drawings.art.images[0]).toEqual(importedImage);

    const transform = { x: 71.25, y: -4.5, rotation: -0.37, scale: 1.125 };
    const updated = dispatch(added, {
      type: "updateDrawingImage",
      drawingId: "art",
      imageId: importedImage.id,
      transform,
    });
    expect(updated.drawings.art.images[0].transform).toEqual(transform);
    expect(added.drawings.art.images[0].transform).toEqual(importedImage.transform);

    const removed = dispatch(updated, {
      type: "removeDrawingImage",
      drawingId: "art",
      imageId: importedImage.id,
    });
    expect(removed.drawings.art.images).toEqual([]);
    expect(removed.drawings.art.revision).toBe(3);
  });

  it("rejects external image URLs in the world model", () => {
    let world = dispatch(createWorld(), { type: "createDrawing", drawing });
    const result = applyCommand(world, {
      type: "addDrawingImage",
      drawingId: "art",
      image: { ...importedImage, source: "https://example.com/cat.svg" },
    });
    expect(result.error.code).toBe("INVALID_DRAWING_IMAGE");
  });

  it("creates a centered cutout atomically", () => {
    let world = dispatch(createWorld({ minCutoutArea: 20 }), { type: "createDrawing", drawing });
    world = dispatch(world, { type: "addStroke", drawingId: "art", stroke });
    const result = applyCommand(world, { type: "createCutout", sourceDrawingId: "art", newDrawingId: "piece-art", entityId: "piece", contour, worldPosition: { x: 300, y: 300 } });
    expect(result.ok).toBe(true);
    expect(result.world.entities.piece).toMatchObject({ kind: "cutout", drawingId: "piece-art", anchor: { x: 0, y: 0 } });
    expect(result.world.drawings["piece-art"].strokes).toHaveLength(1);
    expect(applyCommand(world, { type: "createCutout", sourceDrawingId: "art", newDrawingId: "x", entityId: "x", contour: contour.slice(0, 3) }).error.code).toBe("CONTOUR_NOT_CLOSED");
  });

  it("keeps imported art aligned when creating a cutout", () => {
    let world = dispatch(createWorld({ minCutoutArea: 20 }), {
      type: "createDrawing",
      drawing: { ...drawing, images: [importedImage] },
    });
    const result = applyCommand(world, {
      type: "createCutout",
      sourceDrawingId: "art",
      newDrawingId: "image-piece-art",
      entityId: "image-piece",
      contour,
      worldPosition: { x: 300, y: 300 },
    });
    expect(result.ok).toBe(true);
    const anchor = result.world.entities["image-piece"].transform;
    const copied = result.world.drawings["image-piece-art"].images[0];
    expect(copied.transform.rotation).toBe(importedImage.transform.rotation);
    expect(copied.transform.scale).toBe(importedImage.transform.scale);
    expect(copied.transform.x).not.toBe(importedImage.transform.x);
    expect(anchor).toEqual({ x: 300, y: 300, rotation: 0, scale: 1 });
  });

  it("undoes, redoes and leaves failed groups untouched", () => {
    let history = createHistory(createWorld());
    let result = applyHistoryCommand(history, { type: "createDrawing", drawing }); history = result.history;
    result = applyHistoryCommand(history, { type: "addStroke", drawingId: "art", stroke }); history = result.history;
    const undone = undo(history); expect(undone.world.drawings.art.strokes).toHaveLength(0);
    const redone = redo(undone.history); expect(redone.world.drawings.art.strokes).toHaveLength(1);
  });

  it("invalidates only a changed drawing texture revision", () => {
    const destroyed = [], cache = new DrawingTextureCache((d) => `${d.id}:${d.revision}`, (x) => destroyed.push(x));
    expect(cache.get({ id: "a", revision: 0 })).toBe("a:0");
    expect(cache.get({ id: "b", revision: 0 })).toBe("b:0");
    expect(cache.get({ id: "a", revision: 1 })).toBe("a:1");
    expect(destroyed).toEqual(["a:0"]);
    expect(cache.get({ id: "b", revision: 0 })).toBe("b:0");
  });

  it("keeps separate LOD entries and evicts the least recently used invisible entry", () => {
    const destroyed = [], cache = new DrawingTextureCache((item, lod) => `${item.id}:${lod}`, (item) => destroyed.push(item), { maxEntries: 2 });
    const a = { id: "a", revision: 0 }, b = { id: "b", revision: 0 };
    expect(cache.get(a, { lod: 1, visible: false })).toBe("a:1"); expect(cache.get(a, { lod: .5 })).toBe("a:0.5"); expect(cache.get(b)).toBe("b:1");
    expect(cache.size).toBe(2); expect(destroyed).toContain("a:1"); expect(cache.get(a, { lod: 1 })).toBe("a:1");
  });
});
