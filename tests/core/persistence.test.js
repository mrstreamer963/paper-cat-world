import { describe, expect, it } from "vitest";
import { applyCommand, createWorld, loadWorld, migrations, serializeWorld } from "../../src/core/index.js";

const drawing = { id: "z-art", width: 40, height: 30, background: "transparent", strokes: [{ id: "s", tool: "brush", color: "#000000", width: 2, points: [{ x: 1, y: 2, pressure: .5 }] }] };

describe("world persistence", () => {
  it("round-trips a stable v1 envelope and excludes runtime state", () => {
    let world = createWorld({ width: 200, height: 100 }); world = applyCommand(world, { type: "createDrawing", drawing }).world;
    const envelope = serializeWorld({ ...world, selection: "z", camera: { zoom: 3 } }, { title: "My world", ignored: true });
    expect(Object.keys(envelope.world)).toEqual(["table", "entities", "surfaces", "drawings"]);
    expect(envelope.metadata).toEqual({ title: "My world" });
    const loaded = loadWorld(JSON.stringify(envelope)); expect(loaded.ok).toBe(true);
    expect(serializeWorld(loaded.world, loaded.metadata)).toEqual(envelope);
  });

  it.each([
    ["", "INVALID_JSON"], ["[]", "INVALID_FORMAT"], [JSON.stringify({ format: "other", schemaVersion: 1 }), "INVALID_FORMAT"],
    [JSON.stringify({ format: "paper-cat-world", schemaVersion: 2 }), "UNSUPPORTED_SCHEMA_VERSION"],
  ])("rejects invalid input without throwing", (input, code) => expect(loadWorld(input).error.code).toBe(code));

  it("reports missing templates distinctly", () => {
    const envelope = serializeWorld(createWorld()); envelope.world.entities.cat = { id: "cat", kind: "cat", templateId: "missing", drawingId: "art", attachmentSurfaceId: "wear", surfaceId: "table", transform: { x: 1, y: 1, rotation: 0, scale: 1 }, zIndex: 0 };
    expect(loadWorld(envelope).error.code).toBe("MISSING_TEMPLATE");
  });
  it("starts schema v1 with an explicit empty migration registry", () => expect(migrations).toEqual({}));
});
