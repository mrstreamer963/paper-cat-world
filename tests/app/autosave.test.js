import { describe, expect, it, vi } from "vitest";
import { AutosaveService, AUTOSAVE_KEY } from "../../src/app/autosave.js";

describe("AutosaveService", () => {
  it("debounces and writes the latest prepared snapshot", () => {
    vi.useFakeTimers(); const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() }; const service = new AutosaveService({ storage, serialize: (world) => world, delay: 500 });
    service.prepare({ n: 1 }); service.prepare({ n: 2 }); vi.advanceTimersByTime(500);
    expect(storage.setItem).toHaveBeenCalledOnce(); expect(storage.setItem).toHaveBeenCalledWith(AUTOSAVE_KEY, '{"n":2}'); vi.useRealTimers();
  });
  it("does not throw when storage is unavailable", () => { const onError = vi.fn(), service = new AutosaveService({ storage: { setItem() { throw new Error("no"); } }, serialize: (x) => x, onError }); service.prepare({ ok: true }); expect(service.flush()).toBe(false); expect(onError).toHaveBeenCalled(); });
});
