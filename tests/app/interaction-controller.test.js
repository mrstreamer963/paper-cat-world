import { describe, expect, it } from "vitest";
import { canAttachToCat, InteractionController, surfaceCandidatesForDrop } from "../../src/app/interaction-controller.js";
import { createFixtureWorld } from "../../src/app/fixture.js";
import { WorldStore } from "../../src/app/world-store.js";
import { applyCommand, getEntityWorldTransform } from "../../src/core/index.js";

const rectangle = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const catTemplate = { templateId: "paper-cat-v1", viewBox: { x: 0, y: 0, width: 220, height: 300 }, silhouette: rectangle(0, 0, 220, 300), zones: { head: { zoneId: "head", layer: 1, tiePriority: 0, polygons: [rectangle(0, 0, 220, 110)] }, face: { zoneId: "face", layer: 2, tiePriority: 1, polygons: [rectangle(70, 50, 80, 50)] }, body: { zoneId: "body", layer: 0, tiePriority: 2, polygons: [rectangle(0, 110, 220, 150)] }, paws: { zoneId: "paws", layer: 2, tiePriority: 3, polygons: [rectangle(0, 260, 220, 40)] }, back: { zoneId: "back", layer: -1, tiePriority: 4, polygons: [rectangle(0, 110, 220, 190)] } } };

describe("cat drop eligibility", () => {
  it("allows only items and clothing", () => {
    expect(canAttachToCat({ kind: "paper" })).toBe(false);
    expect(canAttachToCat({ kind: "cutout", item: true })).toBe(true);
    expect(canAttachToCat({ kind: "cutout", wearable: {} })).toBe(true);
    expect(canAttachToCat({ kind: "sheet" })).toBe(false);
    expect(canAttachToCat({ kind: "cutout" })).toBe(false);
    expect(canAttachToCat({ kind: "notebook" })).toBe(false);
    expect(canAttachToCat({ kind: "container" })).toBe(false);
    expect(canAttachToCat({ kind: "cat" })).toBe(false);
  });

  it("does not let ordinary paper fall through a cat onto a lower host", () => {
    const table = { id: "table", kind: "table" }, cover = { id: "home-cover", kind: "notebook-cover" }, wear = { id: "cat-wear", kind: "cat-attachments" };
    const world = { surfaces: { table, "home-cover": cover, "cat-wear": wear } };
    const hits = [{ id: "cat", kind: "cat", surfaceId: "table" }, { id: "home", kind: "notebook" }];

    expect(surfaceCandidatesForDrop(world, { kind: "paper" }, hits, [wear, cover, table]).map((surface) => surface.id)).toEqual(["table", "home-cover"]);
  });

  it("falls back beside the top paper before considering a lower host", () => {
    const table = { id: "table", kind: "table" }, ticketSurface = { id: "ticket-surface", kind: "generic", hostEntityId: "ticket" }, cover = { id: "home-cover", kind: "notebook-cover", hostEntityId: "home" };
    const world = { surfaces: { table, "ticket-surface": ticketSurface, "home-cover": cover } };
    const hits = [{ id: "ticket", kind: "paper", surfaceId: "table" }, { id: "home", kind: "notebook", surfaceId: "table" }];

    expect(surfaceCandidatesForDrop(world, { kind: "paper" }, hits, [ticketSurface, cover, table]).map((surface) => surface.id)).toEqual(["ticket-surface", "table", "home-cover"]);
  });

  it("reparents loose objects carried off a nested surface", () => {
    let world = createFixtureWorld();
    for (const [entityId, x, y] of [["note-yellow", 150, 680], ["note-pink", 180, 700]]) {
      const moved = applyCommand(world, { type: "moveEntityInWorld", entityId, targetSurfaceId: "notebook-a-cover", transform: { x, y, rotation: 0, scale: 1 }, zPolicy: "front" });
      expect(moved.ok).toBe(true); world = moved.world;
    }
    const droppedTransform = { x: 600, y: 500, rotation: 0, scale: 1 };
    const store = new WorldStore(world), ui = { selectedEntityId: null, dragPreview: { entityId: "note-yellow", carriedEntityIds: ["note-pink"], transform: droppedTransform } };
    const controller = Object.assign(Object.create(InteractionController.prototype), { store, ui, renderer: { hitTest: () => [], getSurfaceCandidates: () => [world.surfaces.table], screenToWorld: (point) => point }, update: () => {}, notify: () => { throw new Error("drop unexpectedly rejected"); }, trace: null });
    const companionBefore = getEntityWorldTransform(world, "note-pink");

    controller.commit({ x: 600, y: 500 });

    expect(store.world.entities["note-yellow"].surfaceId).toBe("table");
    expect(getEntityWorldTransform(store.world, "note-yellow")).toEqual(droppedTransform);
    expect(store.world.entities["note-pink"].surfaceId).toBe("table");
    const companionAfter = getEntityWorldTransform(store.world, "note-pink");
    expect(companionAfter.x - companionBefore.x).toBeCloseTo(450);
    expect(companionAfter.y - companionBefore.y).toBeCloseTo(-180);
  });

  it("keeps the exact trace transform when dropping a folded sheet onto empty table space", () => {
    const world = createFixtureWorld(), requested = { x: -71.16822429906549, y: 477.5700934579439, rotation: -.04, scale: 1 };
    const store = new WorldStore(world), ui = { selectedEntityId: null, dragPreview: { entityId: "sheet-car", carriedEntityIds: [], transform: requested } };
    const controller = Object.assign(Object.create(InteractionController.prototype), { store, ui, renderer: { hitTest: () => [], getSurfaceCandidates: () => [world.surfaces.table], screenToWorld: () => ({ x: 173.24766355140193, y: 492.58177570093454 }) }, update: () => {}, notify: () => { throw new Error("drop unexpectedly rejected"); }, trace: null });

    controller.commit({ x: 459, y: 523.5 });

    expect(store.world.entities["sheet-car"].transform).toEqual(requested);
  });

  it("starts wearable attachment animation at the current drag preview", () => {
    const world = createFixtureWorld({ "paper-cat-v1": catTemplate }), requested = { x: 1057.7803738317757, y: 174.97663551401877, rotation: 0, scale: 1 };
    const store = new WorldStore(world), ui = { selectedEntityId: null, dragPreview: { entityId: "purple-hat", carriedEntityIds: [], transform: requested } };
    let emittedEvents = [];
    store.subscribe(({ events }) => { emittedEvents = events; });
    const controller = Object.assign(Object.create(InteractionController.prototype), { store, ui, renderer: { hitTest: () => [world.entities["cat-orange"]], getSurfaceCandidates: () => [world.surfaces["cat-orange-wear"], world.surfaces.table], screenToWorld: (point) => point }, update: () => {}, notify: () => { throw new Error("drop unexpectedly rejected"); }, trace: null });

    controller.commit({ x: 1300.5, y: 222 });

    expect(store.world.entities["purple-hat"].attachment.catId).toBe("cat-orange");
    expect(emittedEvents).toContainEqual(expect.objectContaining({ type: "wearableAttached", wearableId: "purple-hat", fromWorldTransform: requested }));
  });

});
