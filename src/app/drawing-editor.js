import { getEntityWorldTransform } from "../core/index.js";
import { importDrawingImage } from "./imported-image.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const cloneStroke = (stroke) => ({
  ...stroke,
  points: stroke.points.map((point) => ({ ...point })),
});
const cloneImage = (image) => ({
  ...image,
  transform: { ...image.transform },
});
const rotatePoint = (point, angle) => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

export class DrawingEditor {
  constructor({ element, store, notify, onClose, template }) {
    Object.assign(this, {
      element,
      store,
      notify,
      onClose,
      template,
      drawingId: null,
      entityId: null,
      draft: null,
      pointers: new Map(),
      tool: "brush",
      color: "#3a312e",
      size: 8,
      camera: { x: 0, y: 0, zoom: 2 },
      committedCanvas: null,
      committedKey: null,
      selectedImageId: null,
      imageGesture: null,
      imagePreview: null,
      imageCache: new Map(),
      abortController: new AbortController(),
    });
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.testid = "drawing-canvas";
    this.ctx = this.canvas.getContext("2d");
    this.bind();
    this.unsubscribe = store.subscribe(() => {
      if (this.drawingId || this.draft) this.render();
    });
  }
  bind() {
    const signal = this.abortController.signal;
    for (const button of this.element.querySelectorAll("[data-tool]"))
      button.onclick = () => {
        this.tool = button.dataset.tool;
        this.sync();
        this.render();
      };
    this.element.querySelector("[data-color]").oninput = (event) => {
      this.color = event.target.value;
    };
    this.element.querySelector("[data-size]").oninput = (event) => {
      this.size = Number(event.target.value);
    };
    const imageInput = this.element.querySelector("[data-image-import]");
    this.element.querySelector("[data-action=add-image]").onclick = () => {
      imageInput.value = "";
      imageInput.click();
    };
    imageInput.onchange = () => this.importImage(imageInput.files?.[0]);
    this.element.querySelector("[data-action=delete-image]").onclick = () =>
      this.deleteSelectedImage();
    this.element.querySelector("[data-action=undo]").onclick = () =>
      this.draft ? this.draftUndo() : this.store.undo();
    this.element.querySelector("[data-action=redo]").onclick = () =>
      this.draft ? this.draftRedo() : this.store.redo();
    this.element.querySelector("[data-action=done]").onclick = () =>
      this.finish();
    this.element.querySelector("[data-action=close]").onclick = () =>
      this.close();
    this.canvas.addEventListener("pointerdown", (event) => this.down(event), {
      signal,
    });
    this.canvas.addEventListener("pointermove", (event) => this.move(event), {
      signal,
    });
    this.canvas.addEventListener("pointerup", (event) => this.up(event), {
      signal,
    });
    this.canvas.addEventListener("pointercancel", () => this.cancelGesture(), {
      signal,
    });
    addEventListener(
      "keydown",
      (event) => {
        if (this.element.hidden) return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          event.shiftKey
            ? this.draft
              ? this.draftRedo()
              : this.store.redo()
            : this.draft
              ? this.draftUndo()
              : this.store.undo();
        }
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          this.selectedImageId
        ) {
          event.preventDefault();
          this.deleteSelectedImage();
        }
        if (event.key === "Escape") this.close();
      },
      { signal },
    );
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
  }
  destroy() {
    this.abortController.abort();
    this.resizeObserver.disconnect();
    this.unsubscribe?.();
    for (const image of this.imageCache.values()) image.onload = image.onerror = null;
    this.imageCache.clear();
    for (const control of this.element.querySelectorAll("button, input")) {
      control.onclick = null;
      control.oninput = null;
    }
    this.canvas.remove();
  }
  show() {
    this.element.prepend(this.canvas);
    this.element.hidden = false;
    this.resize();
    this.fit();
    this.sync();
  }
  open(drawingId, entityId) {
    this.draft = null;
    this.drawingId = drawingId;
    this.entityId = entityId;
    this.selectedImageId = null;
    this.show();
  }
  newCat() {
    const { width, height } = this.template.viewBox;
    this.drawingId = null;
    this.entityId = null;
    this.draft = {
      kind: "cat",
      width,
      height,
      strokes: [],
      images: [],
      redo: [],
      padding: 0,
    };
    this.tool = "brush";
    this.show();
  }
  newWearable() {
    const padding = 65,
      { width, height } = this.template.viewBox;
    this.drawingId = null;
    this.entityId = null;
    this.draft = {
      kind: "wearable",
      width: width + padding * 2,
      height: height + padding * 2,
      strokes: [],
      images: [],
      redo: [],
      padding,
      contour: null,
    };
    this.tool = "brush";
    this.show();
  }
  close() {
    this.cancelGesture();
    this.element.hidden = true;
    this.canvas.remove();
    this.drawingId = null;
    this.entityId = null;
    this.draft = null;
    this.selectedImageId = null;
    this.imageGesture = null;
    this.imagePreview = null;
    this.onClose?.();
  }
  finish() {
    if (!this.draft) return this.close();
    if (this.draft.kind === "wearable") {
      if (!this.draft.contour) return this.notify("DRAW_CONTOUR");
      return this.commitWearable(this.draft.contour);
    }
    const drawingId = uid("cat-art"),
      catId = uid("cat"),
      attachmentSurfaceId = uid("cat-wear");
    const result = this.store.dispatchGroup([
      {
        type: "createDrawing",
        drawing: {
          id: drawingId,
          width: this.draft.width,
          height: this.draft.height,
          background: "transparent",
          strokes: this.draft.strokes.map(cloneStroke),
          images: this.draft.images.map(cloneImage),
        },
      },
      {
        type: "createCat",
        catId,
        drawingId,
        attachmentSurfaceId,
        templateId: this.template.templateId,
        targetSurfaceId: this.store.world.table.surfaceId,
        transform: { x: 560, y: 300, rotation: 0, scale: 0.72 },
      },
    ]);
    if (!result.ok) return this.notify(result.error.code);
    this.close();
  }
  resize() {
    if (this.element.hidden) return;
    const rect = this.canvas.getBoundingClientRect(),
      ratio = devicePixelRatio || 1;
    this.canvas.width = rect.width * ratio;
    this.canvas.height = rect.height * ratio;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.render();
  }
  currentDrawing() {
    return this.draft ?? this.store.world.drawings[this.drawingId];
  }
  showsFoldGuide() {
    const entity = this.store.world.entities[this.entityId],
      inside =
        entity?.kind === "sheet"
          ? this.store.world.surfaces[entity.insideSurfaceId]
          : null;
    return inside?.drawingId === this.drawingId;
  }
  fit() {
    const drawing = this.currentDrawing(),
      rect = this.canvas.getBoundingClientRect();
    if (!drawing) return;
    this.camera.zoom = Math.min(
      (rect.width - 80) / drawing.width,
      (rect.height - 150) / drawing.height,
      4,
    );
    this.camera.x = (rect.width - drawing.width * this.camera.zoom) / 2;
    this.camera.y = (rect.height - drawing.height * this.camera.zoom) / 2;
    this.render();
  }
  screen(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  doc(point) {
    return {
      x: (point.x - this.camera.x) / this.camera.zoom,
      y: (point.y - this.camera.y) / this.camera.zoom,
    };
  }
  pressure(event) {
    return event.pointerType === "mouse" ||
      !Number.isFinite(event.pressure) ||
      event.pressure === 0
      ? 0.5
      : Math.max(0, Math.min(1, event.pressure));
  }
  down(event) {
    const point = this.screen(event);
    this.pointers.set(event.pointerId, point);
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Capture may be denied or revoked by WebKit/system gestures. */
    }
    if (this.pointers.size === 2) {
      this.preview = null;
      this.imageGesture = null;
      this.imagePreview = null;
      const [a, b] = this.pointers.values();
      this.pinch = {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        distance: dist(a, b),
        ...this.camera,
      };
      this.render();
      return;
    }
    if (this.pointers.size === 1 && this.tool === "select") {
      this.beginImageGesture(this.doc(point));
      return;
    }
    if (this.pointers.size === 1)
      this.preview = {
        tool: this.tool,
        color: this.color,
        width: this.size,
        points: [{ ...this.doc(point), pressure: this.pressure(event) }],
      };
    this.render();
  }
  move(event) {
    if (!this.pointers.has(event.pointerId)) return;
    const point = this.screen(event);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2) {
      const [a, b] = this.pointers.values(),
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom =
          (this.pinch.zoom * dist(a, b)) / Math.max(1, this.pinch.distance),
        anchor = {
          x: (this.pinch.mid.x - this.pinch.x) / this.pinch.zoom,
          y: (this.pinch.mid.y - this.pinch.y) / this.pinch.zoom,
        };
      this.camera.zoom = Math.max(0.4, Math.min(8, zoom));
      this.camera.x = mid.x - anchor.x * this.camera.zoom;
      this.camera.y = mid.y - anchor.y * this.camera.zoom;
      this.render();
      return;
    }
    if (this.imageGesture) {
      this.updateImageGesture(this.doc(point));
      return;
    }
    if (this.preview) {
      const next = { ...this.doc(point), pressure: this.pressure(event) };
      if (dist(next, this.preview.points.at(-1)) > 0.5)
        this.preview.points.push(next);
      this.render();
    }
  }
  up(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.imageGesture) {
      this.commitImageGesture();
      return;
    }
    if (!this.preview) return;
    const preview = this.preview;
    this.preview = null;
    if (preview.tool === "scissors") this.cut(preview.points);
    else if (this.draft) {
      this.draft.strokes.push({ ...preview, id: uid("stroke") });
      this.draft.redo = [];
    } else
      this.store.dispatch({
        type: "addStroke",
        drawingId: this.drawingId,
        stroke: { ...preview, id: uid("stroke") },
      });
    this.render();
  }
  cancelGesture() {
    this.pointers.clear();
    this.preview = null;
    this.pinch = null;
    this.imageGesture = null;
    this.imagePreview = null;
    this.render();
  }
  images() {
    return this.currentDrawing()?.images ?? [];
  }
  displayedImage(image) {
    return this.imagePreview?.id === image.id ? this.imagePreview : image;
  }
  imagePoint(image, local) {
    const transformed = rotatePoint(
      {
        x: local.x * image.transform.scale,
        y: local.y * image.transform.scale,
      },
      image.transform.rotation,
    );
    return {
      x: image.transform.x + transformed.x,
      y: image.transform.y + transformed.y,
    };
  }
  imageHandles(image) {
    const offset = 30 / Math.max(this.camera.zoom * image.transform.scale, 0.001);
    return {
      scale: this.imagePoint(image, { x: image.width / 2, y: image.height / 2 }),
      rotate: this.imagePoint(image, { x: 0, y: -image.height / 2 - offset }),
    };
  }
  imageContains(image, point) {
    const dx = point.x - image.transform.x,
      dy = point.y - image.transform.y,
      local = rotatePoint({ x: dx, y: dy }, -image.transform.rotation),
      scale = image.transform.scale;
    return (
      Math.abs(local.x) <= (image.width * scale) / 2 &&
      Math.abs(local.y) <= (image.height * scale) / 2
    );
  }
  beginImageGesture(point) {
    const radius = 14 / this.camera.zoom,
      selected = this.images().find((image) => image.id === this.selectedImageId);
    let image = selected,
      mode = null;
    if (selected) {
      const handles = this.imageHandles(selected);
      if (dist(point, handles.rotate) <= radius) mode = "rotate";
      else if (dist(point, handles.scale) <= radius) mode = "scale";
    }
    if (!mode) {
      image = [...this.images()].reverse().find((item) => this.imageContains(item, point));
      if (image) mode = "move";
    }
    this.selectedImageId = image?.id ?? null;
    if (!image) {
      this.sync();
      this.render();
      return;
    }
    this.imagePreview = cloneImage(image);
    this.imageGesture = {
      mode,
      start: point,
      original: { ...image.transform },
      startDistance: Math.max(
        0.001,
        dist(point, { x: image.transform.x, y: image.transform.y }),
      ),
      startAngle: Math.atan2(
        point.y - image.transform.y,
        point.x - image.transform.x,
      ),
    };
    this.sync();
    this.render();
  }
  updateImageGesture(point) {
    const gesture = this.imageGesture,
      image = this.imagePreview;
    if (!gesture || !image) return;
    if (gesture.mode === "move") {
      image.transform.x = gesture.original.x + point.x - gesture.start.x;
      image.transform.y = gesture.original.y + point.y - gesture.start.y;
    } else if (gesture.mode === "scale") {
      const distance = dist(point, {
        x: gesture.original.x,
        y: gesture.original.y,
      });
      image.transform.scale = Math.max(
        0.01,
        Math.min(100, gesture.original.scale * (distance / gesture.startDistance)),
      );
    } else if (gesture.mode === "rotate") {
      const angle = Math.atan2(
        point.y - gesture.original.y,
        point.x - gesture.original.x,
      );
      image.transform.rotation = gesture.original.rotation + angle - gesture.startAngle;
    }
    this.render();
  }
  commitImageGesture() {
    const image = this.imagePreview,
      original = this.imageGesture?.original;
    this.imageGesture = null;
    this.imagePreview = null;
    if (!image || !original) return this.render();
    const changed = ["x", "y", "rotation", "scale"].some(
      (field) => image.transform[field] !== original[field],
    );
    if (changed && this.draft) {
      this.draft.images = this.draft.images.map((item) =>
        item.id === image.id ? cloneImage(image) : item,
      );
      this.draft.redo = [];
    } else if (changed) {
      const result = this.store.dispatch({
        type: "updateDrawingImage",
        drawingId: this.drawingId,
        imageId: image.id,
        transform: image.transform,
      });
      if (!result.ok) this.notify(result.error.code);
    }
    this.render();
  }
  async importImage(file) {
    if (!file) return;
    try {
      const imported = await importDrawingImage(file),
        drawing = this.currentDrawing(),
        image = {
          id: uid("image"),
          ...imported,
          transform: {
            x: drawing.width / 2,
            y: drawing.height / 2,
            rotation: 0,
            scale: Math.max(
              0.01,
              Math.min(
                1,
                (drawing.width * 0.7) / imported.width,
                (drawing.height * 0.7) / imported.height,
              ),
            ),
          },
        };
      if (this.draft) {
        this.draft.images.push(cloneImage(image));
        this.draft.redo = [];
      } else {
        const result = this.store.dispatch({
          type: "addDrawingImage",
          drawingId: this.drawingId,
          image,
        });
        if (!result.ok) return this.notify(result.error.code);
      }
      this.selectedImageId = image.id;
      this.tool = "select";
      this.sync();
      this.render();
    } catch (error) {
      this.notify(error.code ?? "IMAGE_READ_FAILED");
    }
  }
  deleteSelectedImage() {
    const imageId = this.selectedImageId;
    if (!imageId) return;
    if (this.draft) {
      this.draft.images = this.draft.images.filter((image) => image.id !== imageId);
      this.draft.redo = [];
    } else {
      const result = this.store.dispatch({
        type: "removeDrawingImage",
        drawingId: this.drawingId,
        imageId,
      });
      if (!result.ok) return this.notify(result.error.code);
    }
    this.selectedImageId = null;
    this.sync();
    this.render();
  }
  draftUndo() {
    if (!this.draft?.strokes.length) return;
    this.draft.redo.push(this.draft.strokes.pop());
    this.render();
  }
  draftRedo() {
    if (!this.draft?.redo.length) return;
    this.draft.strokes.push(this.draft.redo.pop());
    this.render();
  }
  cut(points) {
    if (this.draft?.kind === "cat") return;
    if (this.draft?.kind === "wearable") return this.commitWearable(points);
    const sourceEntity = this.store.world.entities[this.entityId];
    if (!sourceEntity) return this.notify("ENTITY_NOT_FOUND");
    const pose = getEntityWorldTransform(this.store.world, sourceEntity.id);
    const result = this.store.dispatch({
      type: "createCutout",
      entityId: uid("cutout"),
      newDrawingId: uid("drawing"),
      sourceDrawingId: this.drawingId,
      contour: points,
      targetSurfaceId: this.store.world.table.surfaceId,
      worldPosition: {
        x: pose.x + sourceEntity.width + 45,
        y: pose.y + sourceEntity.height / 2,
      },
    });
    if (!result.ok) this.notify(result.error.code);
    else this.close();
  }
  commitWearable(points) {
    const drawingId = uid("wearable-source"),
      wearableId = uid("wearable"),
      cutoutDrawingId = uid("wearable-art"),
      padding = this.draft.padding;
    const templateContour = points.map(({ x, y }) => ({
      x: x - padding,
      y: y - padding,
    }));
    const result = this.store.dispatchGroup([
      {
        type: "createDrawing",
        drawing: {
          id: drawingId,
          width: this.draft.width,
          height: this.draft.height,
          background: "transparent",
          strokes: this.draft.strokes.map(cloneStroke),
          images: this.draft.images.map(cloneImage),
        },
      },
      {
        type: "createWearableCutout",
        entityId: wearableId,
        newDrawingId: cutoutDrawingId,
        sourceDrawingId: drawingId,
        templateId: this.template.templateId,
        contour: points,
        templateContour,
        targetSurfaceId: this.store.world.table.surfaceId,
        worldPosition: { x: 760, y: 390 },
        label: "Моя одежда",
      },
      { type: "deleteDrawing", drawingId },
    ]);
    if (!result.ok) return this.notify(result.error.code);
    this.close();
  }
  sync() {
    for (const button of this.element.querySelectorAll("[data-tool]"))
      button.classList.toggle("active", button.dataset.tool === this.tool);
    this.element.querySelector("[data-tool=scissors]").hidden =
      this.draft?.kind === "cat";
    this.element.querySelector("[data-action=delete-image]").hidden =
      !this.selectedImageId;
    this.element.querySelector("[data-action=done]").textContent =
      this.draft?.kind === "cat"
        ? "Создать кота"
        : this.draft?.kind === "wearable"
          ? "Обведите ножницами"
          : "Готово";
  }
  cachedImage(source) {
    let image = this.imageCache.get(source);
    if (!image) {
      image = new Image();
      image.onload = () => this.render();
      image.onerror = () => this.notify("IMAGE_READ_FAILED");
      image.src = source;
      this.imageCache.set(source, image);
    }
    return image;
  }
  drawImages(drawing) {
    const context = this.ctx;
    context.save();
    context.beginPath();
    context.rect(
      this.camera.x,
      this.camera.y,
      drawing.width * this.camera.zoom,
      drawing.height * this.camera.zoom,
    );
    context.clip();
    for (const stored of drawing.images ?? []) {
      const item = this.displayedImage(stored),
        image = this.cachedImage(item.source);
      if (!image.complete || image.naturalWidth === 0) continue;
      context.save();
      context.translate(
        this.camera.x + item.transform.x * this.camera.zoom,
        this.camera.y + item.transform.y * this.camera.zoom,
      );
      context.rotate(item.transform.rotation);
      context.scale(
        item.transform.scale * this.camera.zoom,
        item.transform.scale * this.camera.zoom,
      );
      context.drawImage(image, -item.width / 2, -item.height / 2, item.width, item.height);
      context.restore();
    }
    context.restore();
  }
  drawImageSelection() {
    const stored = this.images().find((image) => image.id === this.selectedImageId);
    if (!stored || this.tool !== "select") return;
    const image = this.displayedImage(stored),
      context = this.ctx,
      corners = [
        { x: -image.width / 2, y: -image.height / 2 },
        { x: image.width / 2, y: -image.height / 2 },
        { x: image.width / 2, y: image.height / 2 },
        { x: -image.width / 2, y: image.height / 2 },
      ].map((point) => this.imagePoint(image, point)),
      handles = this.imageHandles(image),
      screen = (point) => ({
        x: this.camera.x + point.x * this.camera.zoom,
        y: this.camera.y + point.y * this.camera.zoom,
      }),
      scaleHandle = screen(handles.scale),
      rotateHandle = screen(handles.rotate),
      top = screen(this.imagePoint(image, { x: 0, y: -image.height / 2 }));
    context.save();
    context.beginPath();
    const first = screen(corners[0]);
    context.moveTo(first.x, first.y);
    for (const corner of corners.slice(1)) {
      const point = screen(corner);
      context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.strokeStyle = "#493b91";
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(rotateHandle.x, rotateHandle.y);
    context.stroke();
    for (const handle of [scaleHandle, rotateHandle]) {
      context.beginPath();
      context.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
      context.fillStyle = "#fff";
      context.fill();
      context.stroke();
    }
    context.restore();
  }
  line(stroke) {
    const context = this.ctx,
      points = stroke.points;
    if (!points.length) return;
    context.save();
    context.globalCompositeOperation =
      stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = stroke.tool === "scissors" ? "#5b3cc4" : stroke.color;
    context.fillStyle = context.strokeStyle;
    context.lineWidth =
      (stroke.tool === "scissors" ? 2 : stroke.width) * this.camera.zoom;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash(stroke.tool === "scissors" ? [8, 6] : []);
    context.beginPath();
    context.moveTo(
      this.camera.x + points[0].x * this.camera.zoom,
      this.camera.y + points[0].y * this.camera.zoom,
    );
    for (const point of points.slice(1))
      context.lineTo(
        this.camera.x + point.x * this.camera.zoom,
        this.camera.y + point.y * this.camera.zoom,
      );
    if (points.length === 1) {
      context.arc(
        this.camera.x + points[0].x * this.camera.zoom,
        this.camera.y + points[0].y * this.camera.zoom,
        context.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      context.fill();
    } else context.stroke();
    context.restore();
  }
  polygon(points, fill, stroke, width = 2) {
    const context = this.ctx;
    context.beginPath();
    context.moveTo(
      this.camera.x + points[0].x * this.camera.zoom,
      this.camera.y + points[0].y * this.camera.zoom,
    );
    for (const point of points.slice(1))
      context.lineTo(
        this.camera.x + point.x * this.camera.zoom,
        this.camera.y + point.y * this.camera.zoom,
      );
    context.closePath();
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = width;
      context.stroke();
    }
  }
  foldGuide(drawing) {
    const context = this.ctx,
      x = this.camera.x + (drawing.width * this.camera.zoom) / 2,
      top = this.camera.y,
      bottom = top + drawing.height * this.camera.zoom;
    context.save();
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.strokeStyle = "#8f8175";
    context.lineWidth = 2;
    context.setLineDash([10, 8]);
    context.stroke();
    context.restore();
  }
  committedLayerKey(drawing) {
    return [
      this.canvas.width,
      this.canvas.height,
      this.camera.x,
      this.camera.y,
      this.camera.zoom,
      drawing.id,
      drawing.revision,
      drawing.strokes.length,
      drawing.strokes.at(-1)?.id,
      this.draft?.kind,
      this.draft?.padding,
      this.showsFoldGuide(),
    ].join("|");
  }
  rebuildCommittedLayer(drawing, rect) {
    if (!this.committedCanvas)
      this.committedCanvas = document.createElement("canvas");
    const layer = this.committedCanvas,
      ratio = devicePixelRatio || 1;
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const previous = this.ctx,
      context = layer.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    this.ctx = context;
    context.save();
    context.fillStyle = "#fff";
    context.shadowColor = "#39280f45";
    context.shadowBlur = 24;
    context.fillRect(
      this.camera.x,
      this.camera.y,
      drawing.width * this.camera.zoom,
      drawing.height * this.camera.zoom,
    );
    context.restore();
    context.save();
    context.beginPath();
    context.rect(
      this.camera.x,
      this.camera.y,
      drawing.width * this.camera.zoom,
      drawing.height * this.camera.zoom,
    );
    context.clip();
    if (this.draft) {
      const offset = this.draft.padding;
      context.save();
      context.translate(offset * this.camera.zoom, offset * this.camera.zoom);
      this.polygon(
        this.template.silhouette,
        this.draft.kind === "cat" ? "#fff8e8" : "#efe9df88",
        "#6d5a4c",
        2,
      );
      context.restore();
    }
    for (const stroke of drawing.strokes) this.line(stroke);
    if (this.showsFoldGuide()) this.foldGuide(drawing);
    context.restore();
    this.ctx = previous;
  }
  render() {
    if (this.element.hidden || !this.ctx) return;
    const drawing = this.currentDrawing(),
      rect = this.canvas.getBoundingClientRect(),
      context = this.ctx;
    context.clearRect(0, 0, rect.width, rect.height);
    if (!drawing) return;
    const key = this.committedLayerKey(drawing);
    if (key !== this.committedKey) {
      this.rebuildCommittedLayer(drawing, rect);
      this.committedKey = key;
    }
    context.drawImage(this.committedCanvas, 0, 0, rect.width, rect.height);
    this.drawImages(drawing);
    if (this.preview) {
      context.save();
      context.beginPath();
      context.rect(
        this.camera.x,
        this.camera.y,
        drawing.width * this.camera.zoom,
        drawing.height * this.camera.zoom,
      );
      context.clip();
      this.line(this.preview);
      context.restore();
    }
    this.drawImageSelection();
  }
}
