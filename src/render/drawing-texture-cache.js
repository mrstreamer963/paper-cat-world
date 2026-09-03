export class DrawingTextureCache {
  constructor(
    createTexture,
    destroyTexture = (texture) => texture?.destroy?.(true),
    { maxEntries = Infinity } = {},
  ) {
    this.createTexture = createTexture;
    this.destroyTexture = destroyTexture;
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.clock = 0;
    this.rebuilds = 0;
  }
  get(drawing, { visible = true, lod = 1 } = {}) {
    if (!drawing) return null;
    const key = lod === 1 ? drawing.id : `${drawing.id}@${lod}`;
    const cached = this.entries.get(key);
    if (cached?.revision === drawing.revision) {
      cached.usedAt = ++this.clock;
      cached.visible = visible;
      return cached.texture;
    }
    if (cached) this.destroyTexture(cached.texture);
    const texture = this.createTexture(drawing, lod);
    this.rebuilds += 1;
    this.entries.set(key, {
      drawingId: drawing.id,
      revision: drawing.revision,
      lod,
      texture,
      usedAt: ++this.clock,
      visible,
    });
    this.evict();
    return texture;
  }
  evict() {
    while (this.entries.size > this.maxEntries) {
      let oldestKey, oldestEntry;
      for (const [key, entry] of this.entries)
        if (
          !oldestEntry ||
          Number(entry.visible) < Number(oldestEntry.visible) ||
          (entry.visible === oldestEntry.visible &&
            entry.usedAt < oldestEntry.usedAt)
        ) {
          oldestKey = key;
          oldestEntry = entry;
        }
      this.destroyTexture(oldestEntry.texture);
      this.entries.delete(oldestKey);
    }
  }
  markInvisible(drawingId) {
    for (const entry of this.entries.values())
      if (entry.drawingId === drawingId) entry.visible = false;
  }
  get size() {
    return this.entries.size;
  }
  invalidate(drawingId) {
    for (const [key, cached] of this.entries)
      if (cached.drawingId === drawingId || key === drawingId) {
        this.destroyTexture(cached.texture);
        this.entries.delete(key);
      }
  }
  clear() {
    for (const { texture } of this.entries.values())
      this.destroyTexture(texture);
    this.entries.clear();
  }
}
