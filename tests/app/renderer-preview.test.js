import { describe, expect, it } from "vitest";
import { createFixtureWorld } from "../../src/app/fixture.js";
import { PixiWorldRenderer } from "../../src/render/pixi-world-renderer.js";
import { applyCommand, getEntityWorldTransform } from "../../src/core/index.js";

describe("renderer drag preview", () => {
  it("moves every nested entity together with its dragged host", () => {
    const world = createFixtureWorld();
    const renderer = Object.create(PixiWorldRenderer.prototype);
    const preview = { entityId: "folder", transform: { x: 270, y: 235, rotation: -.04, scale: 1 } };
    const ticketBefore = renderer.previewPose(world, world.entities.ticket, null);
    const ticketDuring = renderer.previewPose(world, world.entities.ticket, preview);

    expect(ticketDuring.x - ticketBefore.x).toBeCloseTo(100);
    expect(ticketDuring.y - ticketBefore.y).toBeCloseTo(75);
    expect(renderer.isInEntityBranch(world, "ticket", "folder")).toBe(true);
    expect(renderer.isInEntityBranch(world, "note-pink", "folder")).toBe(false);
  });

  it("keeps an item dropped on a note in that note's moving branch", () => {
    let world = createFixtureWorld();
    const ticketPose = { ...getEntityWorldTransform(world, "ticket"), x: 680, y: 570 };
    const moved = applyCommand(world, { type: "moveEntityInWorld", entityId: "ticket", targetSurfaceId: "note-yellow-surface", transform: ticketPose, zPolicy: "front" });
    expect(moved.ok).toBe(true);
    world = moved.world;

    const renderer = Object.create(PixiWorldRenderer.prototype);
    expect(world.entities.ticket.surfaceId).toBe("note-yellow-surface");
    expect(renderer.isInEntityBranch(world, "ticket", "note-yellow")).toBe(true);
    const before = renderer.previewPose(world, world.entities.ticket, null);
    const note = getEntityWorldTransform(world, "note-yellow");
    const during = renderer.previewPose(world, world.entities.ticket, { entityId: "note-yellow", transform: { ...note, x: note.x + 80, y: note.y - 40 } });
    expect(during.x - before.x).toBeCloseTo(80);
    expect(during.y - before.y).toBeCloseTo(-40);
  });

  it("keeps a note dropped anywhere on the pocket attached to it", () => {
    let world = createFixtureWorld();
    const pose = { ...getEntityWorldTransform(world, "note-pink"), x: 900, y: 490 };
    const moved = applyCommand(world, { type: "moveEntityInWorld", entityId: "note-pink", targetSurfaceId: "box-inside", transform: pose, zPolicy: "front" });
    expect(moved.ok).toBe(true);
    world = moved.world;

    const renderer = Object.create(PixiWorldRenderer.prototype);
    expect(world.entities["note-pink"].surfaceId).toBe("box-inside");
    expect(renderer.isInEntityBranch(world, "note-pink", "box")).toBe(true);
    const before = renderer.previewPose(world, world.entities["note-pink"], null);
    const pocket = getEntityWorldTransform(world, "box");
    const during = renderer.previewPose(world, world.entities["note-pink"], { entityId: "box", transform: { ...pocket, x: pocket.x - 55, y: pocket.y + 30 } });
    expect(during.x - before.x).toBeCloseTo(-55);
    expect(during.y - before.y).toBeCloseTo(30);
  });
});
