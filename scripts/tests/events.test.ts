// v8 — structured event writer (buildEvent pure + recordEvent best-effort).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEvent, recordEvent, eventsPath, EVENTS_FILE } from "../../bin/host-bridge/lib/events.mjs";

const made: string[] = [];
function tmpDir() { const d = mkdtempSync(join(tmpdir(), "seyir-")); made.push(d); return d; }
afterEach(() => { for (const d of made) if (existsSync(d)) rmSync(d, { recursive: true, force: true }); delete process.env.MISSION_CONTROL_DATA_DIR; delete process.env.SEYIR_EVENTS; });

describe("buildEvent", () => {
  it("OTel-ish shape with ts/ts_ms/tool/duration_ms/status/exit", () => {
    const e = buildEvent({ tool: "x", durationMs: 12.7, exit: 0, now: 1000 });
    expect(e).toMatchObject({ ts_ms: 1000, tool: "x", duration_ms: 13, status: "ok", exit: 0 });
    expect(e.ts).toBe(new Date(1000).toISOString());
    expect(e.device).toHaveProperty("arch");
  });

  it("nonzero exit forces status=error", () => {
    expect(buildEvent({ tool: "x", exit: 1 }).status).toBe("error");
  });
});

describe("recordEvent", () => {
  it("appends one JSON line to <DATA_DIR>/seyir-defteri-scripts.jsonl", () => {
    const d = tmpDir();
    process.env.MISSION_CONTROL_DATA_DIR = d;
    expect(recordEvent(buildEvent({ tool: "a", durationMs: 5, now: 1 }))).toBe(true);
    expect(recordEvent(buildEvent({ tool: "b", durationMs: 9, now: 2 }))).toBe(true);
    const lines = readFileSync(join(d, EVENTS_FILE), "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).tool).toBe("a");
    expect(eventsPath()).toBe(join(d, EVENTS_FILE));
  });

  it("SEYIR_EVENTS=0 is a no-op (no file)", () => {
    const d = tmpDir();
    process.env.MISSION_CONTROL_DATA_DIR = d;
    process.env.SEYIR_EVENTS = "0";
    expect(recordEvent(buildEvent({ tool: "a" }))).toBe(false);
    expect(existsSync(join(d, EVENTS_FILE))).toBe(false);
  });

  it("never throws on an unwritable dir (best-effort)", () => {
    process.env.MISSION_CONTROL_DATA_DIR = "/proc/nonexistent/cannot/create";
    expect(() => recordEvent(buildEvent({ tool: "a" }))).not.toThrow();
    expect(recordEvent(buildEvent({ tool: "a" }))).toBe(false);
  });
});
