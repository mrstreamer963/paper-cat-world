import { applyCommand } from "../core/index.js";
export class WorldStore {
  constructor(world) { this.world = world; this.listeners = new Set(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  dispatch(command) { const r = applyCommand(this.world, command); if (!r.ok) return r; this.world = r.world; for (const fn of this.listeners) fn({ world: r.world, events: r.events }); return r; }
  try(command) { return applyCommand(this.world, command); }
}
