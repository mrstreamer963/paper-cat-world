export const AUTOSAVE_KEY = "paper-cat-world:autosave:v1";

export class AutosaveService {
  constructor({ storage = globalThis.localStorage, serialize, delay = 500, onError = () => {} }) {
    this.storage = storage; this.serialize = serialize; this.delay = delay; this.onError = onError; this.timer = null; this.prepared = null;
  }
  prepare(world, metadata = {}) {
    try { this.prepared = JSON.stringify(this.serialize(world, metadata)); }
    catch (error) { this.onError(error); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.prepared === null) return true;
    try { this.storage.setItem(AUTOSAVE_KEY, this.prepared); return true; }
    catch (error) { this.onError(Object.assign(error, { code: error?.name === "QuotaExceededError" ? "STORAGE_QUOTA_EXCEEDED" : "STORAGE_UNAVAILABLE" })); return false; }
  }
  read() { try { return this.storage.getItem(AUTOSAVE_KEY); } catch (error) { this.onError(Object.assign(error, { code: "STORAGE_UNAVAILABLE" })); return null; } }
  remove() { try { this.storage.removeItem(AUTOSAVE_KEY); return true; } catch (error) { this.onError(Object.assign(error, { code: "STORAGE_UNAVAILABLE" })); return false; } }
  dispose() { clearTimeout(this.timer); }
}
