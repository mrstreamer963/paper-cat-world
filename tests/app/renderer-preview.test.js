import { describe, expect, it } from "vitest";
import { createFixtureWorld } from "../../src/app/fixture.js";
import { PixiWorldRenderer } from "../../src/render/pixi-world-renderer.js";
import { applyCommand, getEntityWorldTransform } from "../../src/core/index.js";

describe("renderer drag preview", () => {
  it("includes a cup configured as a holdable item in the demo", () => {
    const world = createFixtureWorld();
    expect(world.entities.cup).toEqual(expect.objectContaining({ kind: "cutout", item: true, label: "Чашка" }));
  });

  it("always paints the dragged branch above a different selected branch", () => {
    const world = createFixtureWorld();
    const renderer = Object.create(PixiWorldRenderer.prototype);
    const order = renderer.displayOrder(world, {
      selectedEntityId: "box",
      dragPreview: { entityId: "folder", transform: getEntityWorldTransform(world, "folder") },
    }).map((entity) => entity.id);

    expect(order.at(-1)).toBe("ticket");
    expect(order.indexOf("folder")).toBeGreaterThan(order.indexOf("box"));
    expect(order.indexOf("ticket")).toBeGreaterThan(order.indexOf("box"));
  });

  it("sorts cat attachments by zone layer around the cat body", () => {
    const rect = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    const template = { templateId: "paper-cat-v1", viewBox: { x: 0, y: 0, width: 220, height: 300 }, silhouette: rect(0, 0, 220, 300), zones: { head: { zoneId: "head", layer: 1, tiePriority: 0, polygons: [rect(0, 0, 220, 110)] }, face: { zoneId: "face", layer: 2, tiePriority: 1, polygons: [rect(70, 50, 80, 50)] }, body: { zoneId: "body", layer: 0, tiePriority: 2, polygons: [rect(0, 110, 220, 150)] }, paws: { zoneId: "paws", layer: 2, tiePriority: 3, polygons: [rect(0, 260, 220, 40)] }, back: { zoneId: "back", layer: -1, tiePriority: 4, polygons: [rect(0, 110, 220, 190)] } } };
    let world = createFixtureWorld({ "paper-cat-v1": template });
    const original = world.entities["purple-hat"], attached = (id, zoneId, zIndex) => ({ ...original, id, zIndex, surfaceId: "cat-blue-wear", wearable: { ...original.wearable, zoneId }, attachment: { catId: "cat-blue", zoneId } });
    world = { ...world, entities: { ...world.entities, "purple-hat": attached("purple-hat", "head", 1), "body-item": attached("body-item", "body", 9), "back-item": attached("back-item", "back", 20) } };
    const order = Object.create(PixiWorldRenderer.prototype).paintOrder(world).map((entity) => entity.id);
    expect(order.indexOf("back-item")).toBeLessThan(order.indexOf("cat-blue"));
    expect(order.indexOf("cat-blue")).toBeLessThan(order.indexOf("body-item"));
    expect(order.indexOf("body-item")).toBeLessThan(order.indexOf("purple-hat"));
  });

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

  it("keeps a cutout attached to the ticket when the ticket moves", () => {
    let world = createFixtureWorld();
    const created = applyCommand(world, { type: "createEntity", entity: { id: "piece", kind: "paper", width: 20, height: 20, surfaceId: "ticket-surface", transform: { x: 25, y: 20, rotation: 0, scale: 1 }, zIndex: 1 } });
    expect(created.ok).toBe(true);
    world = created.world;

    const renderer = Object.create(PixiWorldRenderer.prototype);
    expect(renderer.isInEntityBranch(world, "piece", "ticket")).toBe(true);
    const before = renderer.previewPose(world, world.entities.piece, null);
    const ticket = getEntityWorldTransform(world, "ticket");
    const during = renderer.previewPose(world, world.entities.piece, { entityId: "ticket", transform: { ...ticket, x: ticket.x + 45, y: ticket.y - 30 } });
    expect(during.x - before.x).toBeCloseTo(45);
    expect(during.y - before.y).toBeCloseTo(-30);
  });

  it("paints an extracted nested sheet in front of a cat", () => {
    const rect = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    const zones = Object.fromEntries(["head", "face", "body", "paws", "back"].map((zoneId, index) => [zoneId, { zoneId, layer: index - 2, tiePriority: index, polygons: [rect(0, 0, 220, 300)] }]));
    let world = createFixtureWorld({ "paper-cat-v1": { templateId: "paper-cat-v1", viewBox: { x: 0, y: 0, width: 220, height: 300 }, silhouette: rect(0, 0, 220, 300), zones } });
    world = applyCommand(world, { type: "setSheetState", sheetId: "sheet-car", state: "open" }).world;
    world = applyCommand(world, { type: "moveEntityInWorld", entityId: "sheet-nested", targetSurfaceId: "table", transform: { x: 285, y: 500, rotation: 0, scale: 1 }, zPolicy: "front" }).world;
    world = applyCommand(world, { type: "bringEntityToFront", entityId: "sheet-nested" }).world;
    const order = Object.create(PixiWorldRenderer.prototype).paintOrder(world).map((entity) => entity.id);
    expect(order.indexOf("sheet-nested")).toBeGreaterThan(order.indexOf("cat-blue"));
  });

  it("holds an extracted sheet in front of the orange cat and moves it with the cat", () => {
    const rect = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    const zones = Object.fromEntries(["head", "face", "body", "paws", "back"].map((zoneId, index) => [zoneId, { zoneId, layer: zoneId === "back" ? -1 : zoneId === "paws" ? 3 : index, tiePriority: index, polygons: [rect(0, 0, 220, 300)] }]));
    let world = createFixtureWorld({ "paper-cat-v1": { templateId: "paper-cat-v1", viewBox: { x: 0, y: 0, width: 220, height: 300 }, silhouette: rect(0, 0, 220, 300), zones } });
    world = applyCommand(world, { type: "setSheetState", sheetId: "sheet-car", state: "open" }).world;
    world = applyCommand(world, { type: "moveEntityInWorld", entityId: "sheet-nested", targetSurfaceId: "table", transform: { x: 1040, y: 180, rotation: 0, scale: .8 }, zPolicy: "front" }).world;
    const sheetPose = getEntityWorldTransform(world, "sheet-nested");
    const held = applyCommand(world, { type: "holdEntity", entityId: "sheet-nested", catId: "cat-orange" }); expect(held.ok).toBe(true); world = held.world;
    expect(world.entities["sheet-nested"].surfaceId).toBe("cat-orange-wear"); expect(world.entities["sheet-nested"].attachment).toEqual({ kind: "carried", catId: "cat-orange" });
    expect(getEntityWorldTransform(world, "sheet-nested")).toEqual(expect.objectContaining({ x: expect.closeTo(sheetPose.x, 8), y: expect.closeTo(sheetPose.y, 8), rotation: expect.closeTo(sheetPose.rotation, 8), scale: expect.closeTo(sheetPose.scale, 8) }));
    const renderer = Object.create(PixiWorldRenderer.prototype), order = renderer.paintOrder(world).map((entity) => entity.id); expect(order.indexOf("sheet-nested")).toBeGreaterThan(order.indexOf("cat-orange"));
    const before = getEntityWorldTransform(world, "sheet-nested"), cat = getEntityWorldTransform(world, "cat-orange"); world = applyCommand(world, { type: "moveEntityInWorld", entityId: "cat-orange", targetSurfaceId: "table", transform: { ...cat, x: cat.x - 120, y: cat.y + 80 }, zPolicy: "front" }).world;
    const after = getEntityWorldTransform(world, "sheet-nested"); expect(after.x - before.x).toBeCloseTo(-120); expect(after.y - before.y).toBeCloseTo(80);
    const released = applyCommand(world, { type: "releaseHeldEntity", entityId: "sheet-nested", targetSurfaceId: "table", worldTransform: after }); expect(released.ok).toBe(true); expect(released.world.entities["sheet-nested"].attachment).toBeNull(); expect(getEntityWorldTransform(released.world, "sheet-nested").scale).toBeCloseTo(.8);
  });
});
