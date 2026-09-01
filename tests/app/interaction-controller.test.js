import { describe, expect, it } from "vitest";
import { canAttachToCat, surfaceCandidatesForDrop } from "../../src/app/interaction-controller.js";

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
});
