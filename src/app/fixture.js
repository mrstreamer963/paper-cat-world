import { applyCommand, createWorld } from "../core/index.js";
const t = (x, y, rotation = 0, scale = 1) => ({ x, y, rotation, scale });
const area = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
export function createFixtureWorld(templates = {}) {
  let world = createWorld({ table: { width: 1400, height: 900 }, templates });
  let drawing = applyCommand(world, { type: "createDrawing", drawing: { id: "main-drawing", width: 210, height: 135, background: "#f3cc62", strokes: [] } });
  if (!drawing.ok) throw new Error(`Fixture: ${drawing.error.code}`); world = drawing.world;
  const add = (entity, surfaces = []) => { const r = applyCommand(world, { type: "createEntity", entity, surfaces }); if (!r.ok) throw new Error(`Fixture: ${r.error.code}`); world = r.world; };
  add({ id: "folder", kind: "container", label: "Большой конверт", color: 0xd88967, width: 360, height: 250, surfaceId: "table", transform: t(170, 160, -.04), zIndex: 1 }, [{ id: "folder-inside", kind: "generic", hostEntityId: "folder", transform: t(0, 0), placementArea: area(360, 250), localVisibility: "visible" }]);
  add({ id: "box", kind: "container", label: "Карман", color: 0x68a7a0, width: 290, height: 210, surfaceId: "table", transform: t(890, 480, .05), zIndex: 2 }, [{ id: "box-inside", kind: "generic", hostEntityId: "box", transform: t(0, 0), placementArea: area(290, 210), localVisibility: "visible" }]);
  add({ id: "note-pink", kind: "paper", label: "Розовая записка", color: 0xf08ea6, width: 180, height: 120, surfaceId: "table", transform: t(620, 180, .12), zIndex: 3 }, [{ id: "note-pink-surface", kind: "generic", hostEntityId: "note-pink", transform: t(0, 0), placementArea: area(180, 120), localVisibility: "visible" }]);
  add({ id: "note-yellow", kind: "paper", label: "Бумага для рисования", drawingId: "main-drawing", color: 0xf3cc62, width: 210, height: 135, surfaceId: "table", transform: t(610, 520, -.09), zIndex: 4 }, [{ id: "note-yellow-surface", kind: "generic", hostEntityId: "note-yellow", transform: t(0, 0), placementArea: area(210, 135), localVisibility: "visible" }]);
  add({ id: "ticket", kind: "paper", label: "Билет", color: 0x9bb6e5, width: 150, height: 82, surfaceId: "folder-inside", transform: t(70, 55, .06), zIndex: 1 }, [{ id: "ticket-surface", kind: "generic", hostEntityId: "ticket", transform: t(0, 0), placementArea: area(150, 82), localVisibility: "visible" }]);
  if (templates["paper-cat-v1"]) {
    const makeDrawing = (id, color) => { const result = applyCommand(world, { type: "createDrawing", drawing: { id, width: 220, height: 300, background: "transparent", strokes: [{ id: `${id}-fill`, tool: "brush", color, width: 95, points: [{ x: 110, y: 75, pressure: .5 }, { x: 110, y: 235, pressure: .5 }] }] } }); if (!result.ok) throw new Error(`Fixture: ${result.error.code}`); world = result.world; };
    makeDrawing("cat-blue-art", "#78b9dc"); makeDrawing("cat-orange-art", "#e99a56"); makeDrawing("hat-source", "#8c63c7");
    for (const command of [
      { type: "createCat", catId: "cat-blue", drawingId: "cat-blue-art", attachmentSurfaceId: "cat-blue-wear", templateId: "paper-cat-v1", targetSurfaceId: "table", transform: t(260, 480, -.05, .72) },
      { type: "createCat", catId: "cat-orange", drawingId: "cat-orange-art", attachmentSurfaceId: "cat-orange-wear", templateId: "paper-cat-v1", targetSurfaceId: "table", transform: t(1010, 105, .06, .72) },
      { type: "createWearableCutout", entityId: "purple-hat", newDrawingId: "purple-hat-art", sourceDrawingId: "hat-source", templateId: "paper-cat-v1", contour: [{ x: 25, y: 52 }, { x: 195, y: 52 }, { x: 162, y: 20 }, { x: 58, y: 20 }, { x: 25, y: 52 }], targetSurfaceId: "table", worldPosition: { x: 735, y: 380 }, label: "Шляпа" },
    ]) { const result = applyCommand(world, command); if (!result.ok) throw new Error(`Fixture: ${result.error.code}`); world = result.world; }
  }
  return world;
}
