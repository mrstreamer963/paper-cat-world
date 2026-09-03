import {
  applyCommand,
  applyHistoryCommand,
  applyHistoryGroup,
  commitHistoryResult,
  createHistory,
  redo,
  undo,
} from "../core/index.js";
const trialKey = (commands) => JSON.stringify(commands);
export class WorldStore {
  constructor(world, { trace = null } = {}) {
    this.world = world;
    this.history = createHistory(world);
    this.listeners = new Set();
    this.trials = new WeakMap();
    this.trace = trace;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  dispatch(command) {
    const prepared = this.trials.get(command),
      reusable =
        prepared?.baseWorld === this.world &&
        prepared.key === trialKey(command),
      r = reusable
        ? commitHistoryResult(this.history, prepared.result, command)
        : applyHistoryCommand(this.history, command);
    this.trials.delete(command);
    this.trace?.record("command", { command, ok: r.ok, error: r.error });
    if (!r.ok) return r;
    this.history = r.history;
    this.world = r.world;
    this.emit(r.events);
    return r;
  }
  dispatchGroup(commands) {
    const prepared = this.trials.get(commands),
      reusable =
        prepared?.baseWorld === this.world &&
        prepared.key === trialKey(commands),
      r = reusable
        ? commitHistoryResult(this.history, prepared.result, commands)
        : applyHistoryGroup(this.history, commands);
    this.trials.delete(commands);
    this.trace?.record("commandGroup", { commands, ok: r.ok, error: r.error });
    if (!r.ok) return r;
    this.history = r.history;
    this.world = r.world;
    this.emit(r.events);
    return r;
  }
  try(command) {
    const baseWorld = this.world,
      result = applyCommand(baseWorld, command);
    if (result.ok)
      this.trials.set(command, { baseWorld, key: trialKey(command), result });
    else
      this.trace?.record("commandTrialRejected", {
        command,
        error: result.error,
      });
    return result;
  }
  tryGroup(commands) {
    const baseWorld = this.world;
    let world = baseWorld;
    const events = [];
    for (const command of commands) {
      const result = applyCommand(world, command);
      if (!result.ok) {
        this.trace?.record("commandGroupTrialRejected", {
          commands,
          failedCommand: command,
          error: result.error,
        });
        return result;
      }
      world = result.world;
      events.push(...result.events);
    }
    const result = { ok: true, world, events };
    this.trials.set(commands, { baseWorld, key: trialKey(commands), result });
    return result;
  }
  undo() {
    return this.navigate(undo(this.history));
  }
  redo() {
    return this.navigate(redo(this.history));
  }
  navigate(r) {
    this.trace?.record("historyNavigation", {
      ok: r.ok,
      error: r.error,
      events: r.events,
    });
    if (!r.ok) return r;
    this.history = r.history;
    this.world = r.world;
    this.emit(r.events);
    return r;
  }
  replace(world, events = [{ type: "worldReplaced" }]) {
    this.trace?.record("worldReplaced", { events });
    this.world = world;
    this.history = createHistory(world);
    this.emit(events);
    return { ok: true, world, history: this.history, events };
  }
  emit(events) {
    for (const fn of this.listeners) fn({ world: this.world, events });
  }
}
