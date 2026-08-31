export class DrawingTextureCache {
  constructor(createTexture, destroyTexture = (texture) => texture?.destroy?.(true)) {
    this.createTexture = createTexture; this.destroyTexture = destroyTexture; this.entries = new Map();
  }
  get(drawing) {
    if (!drawing) return null;
    const cached = this.entries.get(drawing.id);
    if (cached?.revision === drawing.revision) return cached.texture;
    if (cached) this.destroyTexture(cached.texture);
    const texture = this.createTexture(drawing);
    this.entries.set(drawing.id, { revision: drawing.revision, texture });
    return texture;
  }
  invalidate(drawingId) { const cached = this.entries.get(drawingId); if (cached) this.destroyTexture(cached.texture); this.entries.delete(drawingId); }
  clear() { for (const { texture } of this.entries.values()) this.destroyTexture(texture); this.entries.clear(); }
}
