export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export class Camera {
  constructor({ minZoom = .35, maxZoom = 3 } = {}) { Object.assign(this, { x: 0, y: 0, zoom: 1, minZoom, maxZoom, viewport: { width: 1, height: 1 } }); }
  setViewport(width, height) { this.viewport = { width, height }; }
  worldToScreen({ x, y }) { return { x: x * this.zoom + this.x, y: y * this.zoom + this.y }; }
  screenToWorld({ x, y }) { return { x: (x - this.x) / this.zoom, y: (y - this.y) / this.zoom }; }
  zoomAt(p, z) { const a = this.screenToWorld(p); this.zoom = clamp(z, this.minZoom, this.maxZoom); this.x = p.x - a.x * this.zoom; this.y = p.y - a.y * this.zoom; }
  fit(w, h, pad = 55) { this.zoom = clamp(Math.min(Math.max(1, this.viewport.width - 2 * pad) / w, Math.max(1, this.viewport.height - 2 * pad) / h), this.minZoom, this.maxZoom); this.x = (this.viewport.width - w * this.zoom) / 2; this.y = (this.viewport.height - h * this.zoom) / 2; }
  constrain(w, h, margin = 80) { this.x = clamp(this.x, margin - w * this.zoom, this.viewport.width - margin); this.y = clamp(this.y, margin - h * this.zoom, this.viewport.height - margin); }
}
