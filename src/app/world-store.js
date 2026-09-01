import { applyCommand, applyHistoryCommand, applyHistoryGroup, createHistory, redo, undo } from "../core/index.js";
export class WorldStore {
  constructor(world, { trace = null } = {}) { this.world = world; this.history = createHistory(world); this.listeners = new Set(); this.trace = trace; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  dispatch(command) { const r = applyHistoryCommand(this.history, command); this.trace?.record("command", { command, ok: r.ok, error: r.error }); if (!r.ok) return r; this.history = r.history; this.world = r.world; this.emit(r.events); return r; }
  dispatchGroup(commands) { const r = applyHistoryGroup(this.history, commands); this.trace?.record("commandGroup", { commands, ok: r.ok, error: r.error }); if (!r.ok) return r; this.history = r.history; this.world = r.world; this.emit(r.events); return r; }
  try(command) { const result = applyCommand(this.world, command); if (!result.ok) this.trace?.record("commandTrialRejected", { command, error: result.error }); return result; }
  tryGroup(commands) { let world = this.world; for (const command of commands) { const result = applyCommand(world, command); if (!result.ok) { this.trace?.record("commandGroupTrialRejected", { commands, failedCommand: command, error: result.error }); return result; } world = result.world; } return { ok: true, world }; }
  undo() { return this.navigate(undo(this.history)); }
  redo() { return this.navigate(redo(this.history)); }
  navigate(r) { this.trace?.record("historyNavigation", { ok: r.ok, error: r.error, events: r.events }); if (!r.ok) return r; this.history = r.history; this.world = r.world; this.emit(r.events); return r; }
  replace(world, events = [{ type: "worldReplaced" }]) { this.trace?.record("worldReplaced", { events }); this.world = world; this.history = createHistory(world); this.emit(events); return { ok: true, world, history: this.history, events }; }
  emit(events) { for (const fn of this.listeners) fn({ world: this.world, events }); }
}
