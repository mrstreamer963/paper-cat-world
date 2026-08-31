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
});
