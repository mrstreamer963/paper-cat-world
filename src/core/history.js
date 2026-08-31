import { applyWorldCommand } from "./commands/index.js";

const error = (code, message) => ({ code, message, details: {} });

export function createHistory(world, { limit = world.rules?.historyLimit ?? 100 } = {}) {
  if (!Number.isInteger(limit) || limit <= 0) throw new TypeError("History limit must be a positive integer");
  return { world, limit, undoStack: [], redoStack: [] };
}

function committed(history, world, events, commands) {
  const undoStack = [...history.undoStack, { before: history.world, after: world, commands }].slice(-history.limit);
  return { ok: true, world, events, history: { ...history, world, undoStack, redoStack: [] } };
}

export function applyHistoryCommand(history, command) {
  const result = applyWorldCommand(history.world, command);
  if (!result.ok) return { ...result, history };
  return committed(history, result.world, result.events, [command]);
}

export function applyHistoryGroup(history, commands) {
  if (!Array.isArray(commands) || commands.length === 0) return { ok: false, world: history.world, history, error: error("UNKNOWN_COMMAND", "A non-empty command group is required") };
  let world = history.world; const events = [];
  for (const command of commands) {
    const result = applyWorldCommand(world, command);
    if (!result.ok) return { ...result, world: history.world, history };
    world = result.world; events.push(...result.events);
  }
  return committed(history, world, events, commands);
}

export function undo(history) {
  if (history.undoStack.length === 0) return { ok: false, world: history.world, history, error: error("HISTORY_EMPTY", "Nothing to undo") };
  const entry = history.undoStack[history.undoStack.length - 1];
  const next = { ...history, world: entry.before, undoStack: history.undoStack.slice(0, -1), redoStack: [...history.redoStack, entry] };
  return { ok: true, world: next.world, history: next, events: [{ type: "historyUndo" }] };
}

export function redo(history) {
  if (history.redoStack.length === 0) return { ok: false, world: history.world, history, error: error("HISTORY_EMPTY", "Nothing to redo") };
  const entry = history.redoStack[history.redoStack.length - 1];
  const next = { ...history, world: entry.after, undoStack: [...history.undoStack, entry].slice(-history.limit), redoStack: history.redoStack.slice(0, -1) };
  return { ok: true, world: next.world, history: next, events: [{ type: "historyRedo" }] };
}
