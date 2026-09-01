import { describe, expect, it } from "vitest";
import { TraceRecorder } from "../../src/app/trace-recorder.js";

describe("TraceRecorder", () => {
  it("keeps a bounded, detached diagnostic history", () => {
    let time = 100; const trace = new TraceRecorder({ limit: 2, now: () => time });
    const details = { entityId: "paper" }; trace.record("down", details); details.entityId = "changed";
    time = 125; trace.record("drop", { ok: true }); time = 150; trace.record("command", { ok: false });
    const exported = trace.export({ entities: {} });
    expect(exported.entries.map((entry) => entry.type)).toEqual(["drop", "command"]);
    expect(exported.entries.map((entry) => entry.atMs)).toEqual([25, 50]);
    expect(exported.finalWorld).toEqual({ entities: {} });
  });

  it("starts a fresh timeline when the world is reset", () => {
    let time = 10; const trace = new TraceRecorder({ now: () => time });
    trace.record("oldWorldAction"); time = 80; trace.reset(); time = 95; trace.record("worldCreated");
    expect(trace.entries).toEqual([{ sequence: 1, atMs: 15, type: "worldCreated" }]);
  });
});
