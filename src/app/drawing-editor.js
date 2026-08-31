import { getEntityWorldTransform } from "../core/index.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const cloneStroke = (stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) });

export class DrawingEditor {
  constructor({ element, store, notify, onClose, template }) {
    Object.assign(this, { element, store, notify, onClose, template, drawingId: null, entityId: null, draft: null, pointers: new Map(), tool: "brush", color: "#3a312e", size: 8, camera: { x: 0, y: 0, zoom: 2 } });
    this.canvas = document.createElement("canvas"); this.canvas.dataset.testid = "drawing-canvas"; this.ctx = this.canvas.getContext("2d");
    this.bind(); this.unsubscribe = store.subscribe(() => { if (this.drawingId || this.draft) this.render(); });
  }
  bind() {
    for (const button of this.element.querySelectorAll("[data-tool]")) button.onclick = () => { this.tool = button.dataset.tool; this.sync(); };
    this.element.querySelector("[data-color]").oninput = (event) => { this.color = event.target.value; };
    this.element.querySelector("[data-size]").oninput = (event) => { this.size = Number(event.target.value); };
    this.element.querySelector("[data-action=undo]").onclick = () => this.draft ? this.draftUndo() : this.store.undo();
    this.element.querySelector("[data-action=redo]").onclick = () => this.draft ? this.draftRedo() : this.store.redo();
    this.element.querySelector("[data-action=done]").onclick = () => this.finish();
    this.element.querySelector("[data-action=close]").onclick = () => this.close();
    this.canvas.addEventListener("pointerdown", (event) => this.down(event)); this.canvas.addEventListener("pointermove", (event) => this.move(event)); this.canvas.addEventListener("pointerup", (event) => this.up(event)); this.canvas.addEventListener("pointercancel", () => this.cancelGesture());
    addEventListener("keydown", (event) => { if (this.element.hidden) return; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? (this.draft ? this.draftRedo() : this.store.redo()) : (this.draft ? this.draftUndo() : this.store.undo()); } if (event.key === "Escape") this.close(); });
    new ResizeObserver(() => this.resize()).observe(this.element);
  }
  show() { this.element.prepend(this.canvas); this.element.hidden = false; this.resize(); this.fit(); this.sync(); }
  open(drawingId, entityId) { this.draft = null; this.drawingId = drawingId; this.entityId = entityId; this.show(); }
  newCat() { const { width, height } = this.template.viewBox; this.drawingId = null; this.entityId = null; this.draft = { kind: "cat", width, height, strokes: [], redo: [], padding: 0 }; this.tool = "brush"; this.show(); }
  newWearable() { const padding = 65, { width, height } = this.template.viewBox; this.drawingId = null; this.entityId = null; this.draft = { kind: "wearable", width: width + padding * 2, height: height + padding * 2, strokes: [], redo: [], padding, contour: null }; this.tool = "brush"; this.show(); }
  close() { this.cancelGesture(); this.element.hidden = true; this.canvas.remove(); this.drawingId = null; this.entityId = null; this.draft = null; this.onClose?.(); }
  finish() {
    if (!this.draft) return this.close();
    if (this.draft.kind === "wearable") { if (!this.draft.contour) return this.notify("DRAW_CONTOUR"); return this.commitWearable(this.draft.contour); }
    const drawingId = uid("cat-art"), catId = uid("cat"), attachmentSurfaceId = uid("cat-wear");
    const result = this.store.dispatchGroup([
      { type: "createDrawing", drawing: { id: drawingId, width: this.draft.width, height: this.draft.height, background: "transparent", strokes: this.draft.strokes.map(cloneStroke) } },
      { type: "createCat", catId, drawingId, attachmentSurfaceId, templateId: this.template.templateId, targetSurfaceId: this.store.world.table.surfaceId, transform: { x: 560, y: 300, rotation: 0, scale: .72 } },
    ]);
    if (!result.ok) return this.notify(result.error.code); this.close();
  }
  resize() { if (this.element.hidden) return; const rect = this.canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1; this.canvas.width = rect.width * ratio; this.canvas.height = rect.height * ratio; this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.render(); }
  currentDrawing() { return this.draft ?? this.store.world.drawings[this.drawingId]; }
  showsFoldGuide() { const entity = this.store.world.entities[this.entityId], inside = entity?.kind === "sheet" ? this.store.world.surfaces[entity.insideSurfaceId] : null; return inside?.drawingId === this.drawingId; }
  fit() { const drawing = this.currentDrawing(), rect = this.canvas.getBoundingClientRect(); if (!drawing) return; this.camera.zoom = Math.min((rect.width - 80) / drawing.width, (rect.height - 150) / drawing.height, 4); this.camera.x = (rect.width - drawing.width * this.camera.zoom) / 2; this.camera.y = (rect.height - drawing.height * this.camera.zoom) / 2; this.render(); }
  screen(event) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  doc(point) { return { x: (point.x - this.camera.x) / this.camera.zoom, y: (point.y - this.camera.y) / this.camera.zoom }; }
  pressure(event) { return event.pointerType === "mouse" || !Number.isFinite(event.pressure) || event.pressure === 0 ? .5 : Math.max(0, Math.min(1, event.pressure)); }
  down(event) { const point = this.screen(event); this.pointers.set(event.pointerId, point); this.canvas.setPointerCapture(event.pointerId); if (this.pointers.size === 2) { this.preview = null; const [a, b] = this.pointers.values(); this.pinch = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: dist(a, b), ...this.camera }; this.render(); return; } if (this.pointers.size === 1) this.preview = { tool: this.tool, color: this.color, width: this.size, points: [{ ...this.doc(point), pressure: this.pressure(event) }] }; this.render(); }
  move(event) { if (!this.pointers.has(event.pointerId)) return; const point = this.screen(event); this.pointers.set(event.pointerId, point); if (this.pointers.size >= 2) { const [a, b] = this.pointers.values(), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom = this.pinch.zoom * dist(a, b) / Math.max(1, this.pinch.distance), anchor = { x: (this.pinch.mid.x - this.pinch.x) / this.pinch.zoom, y: (this.pinch.mid.y - this.pinch.y) / this.pinch.zoom }; this.camera.zoom = Math.max(.4, Math.min(8, zoom)); this.camera.x = mid.x - anchor.x * this.camera.zoom; this.camera.y = mid.y - anchor.y * this.camera.zoom; this.render(); return; } if (this.preview) { const next = { ...this.doc(point), pressure: this.pressure(event) }; if (dist(next, this.preview.points.at(-1)) > .5) this.preview.points.push(next); this.render(); } }
  up(event) { if (!this.pointers.has(event.pointerId)) return; this.pointers.delete(event.pointerId); if (!this.preview) return; const preview = this.preview; this.preview = null; if (preview.tool === "scissors") this.cut(preview.points); else if (this.draft) { this.draft.strokes.push({ ...preview, id: uid("stroke") }); this.draft.redo = []; } else this.store.dispatch({ type: "addStroke", drawingId: this.drawingId, stroke: { ...preview, id: uid("stroke") } }); this.render(); }
  cancelGesture() { this.pointers.clear(); this.preview = null; this.pinch = null; this.render(); }
  draftUndo() { if (!this.draft?.strokes.length) return; this.draft.redo.push(this.draft.strokes.pop()); this.render(); }
  draftRedo() { if (!this.draft?.redo.length) return; this.draft.strokes.push(this.draft.redo.pop()); this.render(); }
  cut(points) { if (this.draft?.kind === "cat") return; if (this.draft?.kind === "wearable") return this.commitWearable(points); const sourceEntity = this.store.world.entities[this.entityId], pose = sourceEntity ? getEntityWorldTransform(this.store.world, sourceEntity.id) : { x: 300, y: 300 }; const result = this.store.dispatch({ type: "createCutout", entityId: uid("cutout"), newDrawingId: uid("drawing"), sourceDrawingId: this.drawingId, contour: points, targetSurfaceId: this.store.world.table.surfaceId, worldPosition: { x: pose.x + sourceEntity.width + 45, y: pose.y + sourceEntity.height / 2 } }); if (!result.ok) this.notify(result.error.code); else this.close(); }
  commitWearable(points) { const drawingId = uid("wearable-source"), wearableId = uid("wearable"), cutoutDrawingId = uid("wearable-art"), padding = this.draft.padding; const templateContour = points.map(({ x, y }) => ({ x: x - padding, y: y - padding })); const result = this.store.dispatchGroup([
    { type: "createDrawing", drawing: { id: drawingId, width: this.draft.width, height: this.draft.height, background: "transparent", strokes: this.draft.strokes.map(cloneStroke) } },
    { type: "createWearableCutout", entityId: wearableId, newDrawingId: cutoutDrawingId, sourceDrawingId: drawingId, templateId: this.template.templateId, contour: points, templateContour, targetSurfaceId: this.store.world.table.surfaceId, worldPosition: { x: 760, y: 390 }, label: "Моя одежда" },
    { type: "deleteDrawing", drawingId },
  ]); if (!result.ok) return this.notify(result.error.code); this.close(); }
  sync() { for (const button of this.element.querySelectorAll("[data-tool]")) button.classList.toggle("active", button.dataset.tool === this.tool); this.element.querySelector("[data-tool=scissors]").hidden = this.draft?.kind === "cat"; this.element.querySelector("[data-action=done]").textContent = this.draft?.kind === "cat" ? "Создать кота" : this.draft?.kind === "wearable" ? "Обведите ножницами" : "Готово"; }
  line(stroke) { const context = this.ctx, points = stroke.points; if (!points.length) return; context.save(); context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over"; context.strokeStyle = stroke.tool === "scissors" ? "#5b3cc4" : stroke.color; context.fillStyle = context.strokeStyle; context.lineWidth = (stroke.tool === "scissors" ? 2 : stroke.width) * this.camera.zoom; context.lineCap = "round"; context.lineJoin = "round"; context.setLineDash(stroke.tool === "scissors" ? [8, 6] : []); context.beginPath(); context.moveTo(this.camera.x + points[0].x * this.camera.zoom, this.camera.y + points[0].y * this.camera.zoom); for (const point of points.slice(1)) context.lineTo(this.camera.x + point.x * this.camera.zoom, this.camera.y + point.y * this.camera.zoom); if (points.length === 1) { context.arc(this.camera.x + points[0].x * this.camera.zoom, this.camera.y + points[0].y * this.camera.zoom, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); } else context.stroke(); context.restore(); }
  polygon(points, fill, stroke, width = 2) { const context = this.ctx; context.beginPath(); context.moveTo(this.camera.x + points[0].x * this.camera.zoom, this.camera.y + points[0].y * this.camera.zoom); for (const point of points.slice(1)) context.lineTo(this.camera.x + point.x * this.camera.zoom, this.camera.y + point.y * this.camera.zoom); context.closePath(); if (fill) { context.fillStyle = fill; context.fill(); } if (stroke) { context.strokeStyle = stroke; context.lineWidth = width; context.stroke(); } }
  foldGuide(drawing) { const context = this.ctx, x = this.camera.x + drawing.width * this.camera.zoom / 2, top = this.camera.y, bottom = top + drawing.height * this.camera.zoom; context.save(); context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.strokeStyle = "#8f8175"; context.lineWidth = 2; context.setLineDash([10, 8]); context.stroke(); context.restore(); }
  render() { if (this.element.hidden || !this.ctx) return; const drawing = this.currentDrawing(), rect = this.canvas.getBoundingClientRect(), context = this.ctx; context.clearRect(0, 0, rect.width, rect.height); if (!drawing) return; context.save(); context.fillStyle = "#fff"; context.shadowColor = "#39280f45"; context.shadowBlur = 24; context.fillRect(this.camera.x, this.camera.y, drawing.width * this.camera.zoom, drawing.height * this.camera.zoom); context.restore(); context.save(); context.beginPath(); context.rect(this.camera.x, this.camera.y, drawing.width * this.camera.zoom, drawing.height * this.camera.zoom); context.clip(); if (this.draft) { const offset = this.draft.padding; context.save(); context.translate(offset * this.camera.zoom, offset * this.camera.zoom); this.polygon(this.template.silhouette, this.draft.kind === "cat" ? "#fff8e8" : "#efe9df88", "#6d5a4c", 2); context.restore(); } for (const stroke of drawing.strokes) this.line(stroke); if (this.preview) this.line(this.preview); if (this.showsFoldGuide()) this.foldGuide(drawing); context.restore(); }
}
