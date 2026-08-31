import { applyCommand, applyHistoryCommand, applyHistoryGroup, createHistory, redo, undo } from "../core/index.js";
export class WorldStore {
  constructor(world) { this.world = world; this.history = createHistory(world); this.listeners = new Set(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  dispatch(command) { const r = applyHistoryCommand(this.history, command); if (!r.ok) return r; this.history = r.history; this.world = r.world; this.emit(r.events); return r; }
  dispatchGroup(commands) { const r = applyHistoryGroup(this.history, commands); if (!r.ok) return r; this.history = r.history; this.world = r.world; this.emit(r.events); return r; }
  try(command) { return applyCommand(this.world, command); }
  tryGroup(commands) { let world = this.world; for (const command of commands) { const result = applyCommand(world, command); if (!result.ok) return result; world = result.world; } return { ok: true, world }; }
  undo() { return this.navigate(undo(this.history)); }
  redo() { return this.navigate(redo(this.history)); }
  navigate(r) { if (!r.ok) return r; this.history = r.history; this.world = r.world; this.emit(r.events); return r; }
  emit(events) { for (const fn of this.listeners) fn({ world: this.world, events }); }
}
