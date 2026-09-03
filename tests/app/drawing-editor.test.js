import { describe, expect, it } from "vitest";
import { DrawingEditor } from "../../src/app/drawing-editor.js";

describe("drawing editor fold guide", () => {
  const editor = (drawingId, entityId = "sheet") => ({
    drawingId,
    entityId,
    store: { world: {
      entities: {
        sheet: { id: "sheet", kind: "sheet", insideSurfaceId: "inside" },
        paper: { id: "paper", kind: "paper" },
      },
      surfaces: { inside: { id: "inside", drawingId: "inside-art" } },
    } },
  });

  it("shows the center guide only for a sheet's inside drawing", () => {
    expect(DrawingEditor.prototype.showsFoldGuide.call(editor("inside-art"))).toBe(true);
    expect(DrawingEditor.prototype.showsFoldGuide.call(editor("top-art"))).toBe(false);
    expect(DrawingEditor.prototype.showsFoldGuide.call(editor("inside-art", "paper"))).toBe(false);
  });

  it("reports a stale source entity instead of throwing while cutting", () => {
    const notifications = [];
    const staleEditor = {
      draft: null,
      drawingId: "missing-art",
      entityId: "missing",
      store: { world: { entities: {}, table: { surfaceId: "table" } } },
      notify: (code) => notifications.push(code),
    };

    expect(() => DrawingEditor.prototype.cut.call(staleEditor, [])).not.toThrow();
    expect(notifications).toEqual(["ENTITY_NOT_FOUND"]);
  });

  it("does not invalidate the committed layer while only the pointer preview changes", () => {
    const layerEditor = { canvas: { width: 800, height: 600 }, camera: { x: 10, y: 20, zoom: 2 }, draft: null, showsFoldGuide: () => false };
    const drawing = { id: "art", revision: 3, strokes: [{ id: "fixed" }] };
    layerEditor.preview = { points: [{ x: 1, y: 1 }] };
    const first = DrawingEditor.prototype.committedLayerKey.call(layerEditor, drawing);
    layerEditor.preview = { points: [{ x: 50, y: 80 }] };
    const second = DrawingEditor.prototype.committedLayerKey.call(layerEditor, drawing);

    expect(second).toBe(first);
  });

  it("hit-tests rotated imported images in their exact local transform", () => {
    const editor = Object.create(DrawingEditor.prototype);
    const image = {
      width: 100,
      height: 40,
      transform: { x: 80, y: 60, rotation: Math.PI / 2, scale: 0.5 },
    };

    expect(editor.imageContains(image, { x: 80, y: 82 })).toBe(true);
    expect(editor.imageContains(image, { x: 105, y: 60 })).toBe(false);
    expect(editor.imagePoint(image, { x: 50, y: 0 })).toEqual(
      expect.objectContaining({ x: expect.closeTo(80, 8), y: expect.closeTo(85, 8) }),
    );
  });
});
