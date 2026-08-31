import { getEntityWorldTransform } from "../core/index.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

export class DrawingEditor {
  constructor({ element, store, notify, onClose }) {
    Object.assign(this, { element, store, notify, onClose, drawingId: null, entityId: null, pointers: new Map(), tool: "brush", color: "#3a312e", size: 8, camera: { x: 0, y: 0, zoom: 2 } });
    this.canvas = document.createElement("canvas"); this.canvas.dataset.testid = "drawing-canvas"; this.ctx = this.canvas.getContext("2d");
    this.bind(); this.unsubscribe = store.subscribe(() => { if (this.drawingId) this.render(); });
  }
  bind() {
    for (const button of this.element.querySelectorAll("[data-tool]")) button.onclick = () => { this.tool = button.dataset.tool; this.sync(); };
    this.element.querySelector("[data-color]").oninput = (e) => { this.color = e.target.value; };
    this.element.querySelector("[data-size]").oninput = (e) => { this.size = Number(e.target.value); };
    this.element.querySelector("[data-action=undo]").onclick = () => this.store.undo(); this.element.querySelector("[data-action=redo]").onclick = () => this.store.redo();
    this.element.querySelector("[data-action=close]").onclick = () => this.close();
    this.canvas.addEventListener("pointerdown", (e) => this.down(e)); this.canvas.addEventListener("pointermove", (e) => this.move(e)); this.canvas.addEventListener("pointerup", (e) => this.up(e)); this.canvas.addEventListener("pointercancel", () => this.cancel());
    addEventListener("keydown", (e) => { if (this.element.hidden) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.store.redo() : this.store.undo(); } if (e.key === "Escape") this.close(); });
    new ResizeObserver(() => this.resize()).observe(this.element);
  }
  open(drawingId, entityId) { this.drawingId = drawingId; this.entityId = entityId; this.element.prepend(this.canvas); this.element.hidden = false; this.resize(); this.fit(); this.sync(); }
  close() { this.cancel(); this.element.hidden = true; this.canvas.remove(); this.drawingId = null; this.onClose?.(); }
  resize() { if (this.element.hidden) return; const r = this.canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1; this.canvas.width = r.width * ratio; this.canvas.height = r.height * ratio; this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.render(); }
  fit() { const d = this.store.world.drawings[this.drawingId], r = this.canvas.getBoundingClientRect(); if (!d) return; this.camera.zoom = Math.min((r.width - 80) / d.width, (r.height - 150) / d.height, 4); this.camera.x = (r.width - d.width * this.camera.zoom) / 2; this.camera.y = (r.height - d.height * this.camera.zoom) / 2; this.render(); }
  screen(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  doc(p) { return { x: (p.x - this.camera.x) / this.camera.zoom, y: (p.y - this.camera.y) / this.camera.zoom }; }
  pressure(e) { return e.pointerType === "mouse" || !Number.isFinite(e.pressure) || e.pressure === 0 ? .5 : Math.max(0, Math.min(1, e.pressure)); }
  down(e) { const p = this.screen(e); this.pointers.set(e.pointerId, p); this.canvas.setPointerCapture(e.pointerId); if (this.pointers.size === 2) { this.preview = null; const [a, b] = this.pointers.values(); this.pinch = { mid: { x: (a.x+b.x)/2, y:(a.y+b.y)/2 }, distance: dist(a,b), ...this.camera }; this.render(); return; } if (this.pointers.size === 1) this.preview = { tool: this.tool, color: this.color, width: this.size, points: [{ ...this.doc(p), pressure: this.pressure(e) }] }; this.render(); }
  move(e) { if (!this.pointers.has(e.pointerId)) return; const p = this.screen(e); this.pointers.set(e.pointerId, p); if (this.pointers.size >= 2) { const [a,b] = this.pointers.values(), mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, zoom=this.pinch.zoom*dist(a,b)/Math.max(1,this.pinch.distance); const anchor={x:(this.pinch.mid.x-this.pinch.x)/this.pinch.zoom,y:(this.pinch.mid.y-this.pinch.y)/this.pinch.zoom}; this.camera.zoom=Math.max(.4,Math.min(8,zoom)); this.camera.x=mid.x-anchor.x*this.camera.zoom; this.camera.y=mid.y-anchor.y*this.camera.zoom; this.render(); return; } if (this.preview) { const q = { ...this.doc(p), pressure: this.pressure(e) }; if (dist(q, this.preview.points.at(-1)) > .5) this.preview.points.push(q); this.render(); } }
  up(e) { if (!this.pointers.has(e.pointerId)) return; this.pointers.delete(e.pointerId); if (!this.preview) return; const preview = this.preview; this.preview = null; if (preview.tool === "scissors") this.cut(preview.points); else this.store.dispatch({ type: "addStroke", drawingId: this.drawingId, stroke: { ...preview, id: uid("stroke") } }); this.render(); }
  cancel() { this.pointers.clear(); this.preview = null; this.pinch = null; this.render(); }
  cut(points) { const sourceEntity = this.store.world.entities[this.entityId], pose = sourceEntity ? getEntityWorldTransform(this.store.world, sourceEntity.id) : { x: 300, y: 300 }; const result = this.store.dispatch({ type: "createCutout", entityId: uid("cutout"), newDrawingId: uid("drawing"), sourceDrawingId: this.drawingId, contour: points, targetSurfaceId: this.store.world.table.surfaceId, worldPosition: { x: pose.x + sourceEntity.width + 45, y: pose.y + sourceEntity.height / 2 } }); if (!result.ok) this.notify(result.error.code); else this.close(); }
  sync() { for (const b of this.element.querySelectorAll("[data-tool]")) b.classList.toggle("active", b.dataset.tool === this.tool); }
  line(stroke, preview=false) { const c=this.ctx, pts=stroke.points; if (!pts.length) return; c.save(); c.globalCompositeOperation=stroke.tool === "eraser" ? "destination-out" : "source-over"; c.strokeStyle=stroke.tool === "scissors" ? "#5b3cc4" : stroke.color; c.fillStyle=c.strokeStyle; c.lineWidth=(stroke.tool === "scissors" ? 2 : stroke.width)*this.camera.zoom; c.lineCap="round"; c.lineJoin="round"; c.setLineDash(stroke.tool === "scissors" ? [8,6] : []); c.beginPath(); c.moveTo(this.camera.x+pts[0].x*this.camera.zoom,this.camera.y+pts[0].y*this.camera.zoom); for(const p of pts.slice(1)) c.lineTo(this.camera.x+p.x*this.camera.zoom,this.camera.y+p.y*this.camera.zoom); if(pts.length===1){c.arc(this.camera.x+pts[0].x*this.camera.zoom,this.camera.y+pts[0].y*this.camera.zoom,c.lineWidth/2,0,Math.PI*2);c.fill();}else c.stroke(); c.restore(); }
  render() { if (this.element.hidden || !this.ctx) return; const d=this.store.world.drawings[this.drawingId], r=this.canvas.getBoundingClientRect(), c=this.ctx; c.clearRect(0,0,r.width,r.height); if(!d)return; c.save(); c.fillStyle=d.background === "transparent" ? "#fff" : d.background; c.shadowColor="#39280f45"; c.shadowBlur=24; c.fillRect(this.camera.x,this.camera.y,d.width*this.camera.zoom,d.height*this.camera.zoom); c.restore(); c.save(); c.beginPath(); c.rect(this.camera.x,this.camera.y,d.width*this.camera.zoom,d.height*this.camera.zoom); c.clip(); for(const s of d.strokes)this.line(s); if(this.preview)this.line(this.preview,true); c.restore(); }
}
