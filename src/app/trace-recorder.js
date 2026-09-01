const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export class TraceRecorder {
  constructor({ limit = 2000, now = () => performance.now() } = {}) { this.limit = limit; this.now = now; this.startedAt = now(); this.entries = []; }
  record(type, details = {}) { this.entries.push({ sequence: this.entries.length ? this.entries.at(-1).sequence + 1 : 1, atMs: Math.round(this.now() - this.startedAt), type, ...clone(details) }); if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit); }
  reset() { this.startedAt = this.now(); this.entries = []; }
  export(world) { return { format: "paper-cat-world-trace", traceVersion: 1, createdAt: new Date().toISOString(), userAgent: typeof navigator === "undefined" ? null : navigator.userAgent, viewport: typeof innerWidth === "undefined" ? null : { width: innerWidth, height: innerHeight, devicePixelRatio: globalThis.devicePixelRatio || 1 }, entries: clone(this.entries), finalWorld: clone(world) }; }
}
