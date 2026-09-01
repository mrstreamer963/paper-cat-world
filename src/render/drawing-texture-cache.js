export class DrawingTextureCache {
  constructor(createTexture, destroyTexture = (texture) => texture?.destroy?.(true), { maxEntries = Infinity } = {}) {
    this.createTexture = createTexture; this.destroyTexture = destroyTexture; this.entries = new Map(); this.maxEntries = maxEntries; this.clock = 0; this.rebuilds = 0;
  }
  get(drawing, { visible = true, lod = 1 } = {}) {
    if (!drawing) return null;
    const key = lod === 1 ? drawing.id : `${drawing.id}@${lod}`;
    const cached = this.entries.get(key);
    if (cached?.revision === drawing.revision) { cached.usedAt = ++this.clock; cached.visible = visible; return cached.texture; }
    if (cached) this.destroyTexture(cached.texture);
    const texture = this.createTexture(drawing, lod);
    this.rebuilds += 1; this.entries.set(key, { drawingId: drawing.id, revision: drawing.revision, lod, texture, usedAt: ++this.clock, visible }); this.evict();
    return texture;
  }
  evict() { while (this.entries.size > this.maxEntries) { const candidates = [...this.entries.entries()].sort(([, a], [, b]) => Number(a.visible) - Number(b.visible) || a.usedAt - b.usedAt); const [id, entry] = candidates[0]; this.destroyTexture(entry.texture); this.entries.delete(id); } }
  markInvisible(drawingId) { for (const entry of this.entries.values()) if (entry.drawingId === drawingId) entry.visible = false; }
  get size() { return this.entries.size; }
  invalidate(drawingId) { for (const [key, cached] of this.entries) if (cached.drawingId === drawingId || key === drawingId) { this.destroyTexture(cached.texture); this.entries.delete(key); } }
  clear() { for (const { texture } of this.entries.values()) this.destroyTexture(texture); this.entries.clear(); }
}
