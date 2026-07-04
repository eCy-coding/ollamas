// fleet-watch seams — tests the PURE rendering inputs bin/fleet-watch.ts composes: tail-parsing of
// worker .log files, the report-verdict cell format, and the RUN/idle decision (log basename ↔ active
// claim key). No alt-screen, no watch loop, no ~/.llm-mission-control — everything runs on temp dirs.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultStore, readClaims, activeClaims, acquireClaim } from "../bin/lib/claims";

let dir = "";
const tmp = () => { dir = mkdtempSync(join(tmpdir(), "fleet-watch-")); return dir; };
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

/** Reproduce main()'s lastLines: last n non-empty lines of a log (missing file → []). */
function lastLines(file: string, n: number): string[] {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n); } catch { return []; }
}
/** Reproduce main()'s reportVerdict cell: `verdict·Nst`, "—" when absent, "partial" on bad JSON. */
function reportVerdict(reportsDir: string, stream: string, slot: string): string {
  const f = join(reportsDir, `${stream}.${slot}.json`);
  if (!existsSync(f)) return "—";
  try { const j = JSON.parse(readFileSync(f, "utf8")); return `${j.verdict ?? "?"}·${(j.steps ?? []).length}st`; }
  catch { return "partial"; }
}

describe("fleet-watch tail-parsing (lastLines)", () => {
  it("returns the last N NON-EMPTY lines — blank lines and the trailing newline never render", () => {
    const f = join(tmp(), "typescript-core.terminal.log");
    writeFileSync(f, "[10:00:01] start\n\n[10:00:02] GPU queue\n[10:00:03] verdict=DONE\n\n");
    expect(lastLines(f, 2)).toEqual(["[10:00:02] GPU queue", "[10:00:03] verdict=DONE"]);
    expect(lastLines(f, 10)).toHaveLength(3); // asking for more than exists is safe
  });
  it("missing log file → [] (worker not started yet, no throw)", () => {
    expect(lastLines(join(tmp(), "nope.log"), 2)).toEqual([]);
  });
});

describe("fleet-watch report-verdict cell", () => {
  it("renders `verdict·Nst` from a worker report; missing fields degrade to `?·0st`", () => {
    const d = tmp();
    writeFileSync(join(d, "shell-harden.iterm2.json"), JSON.stringify({ verdict: "DONE", steps: [{ n: 1 }, { n: 2 }] }));
    writeFileSync(join(d, "test-coverage.terminal.json"), JSON.stringify({ error: "boom" }));
    expect(reportVerdict(d, "shell-harden", "iterm2")).toBe("DONE·2st");
    expect(reportVerdict(d, "test-coverage", "terminal")).toBe("?·0st");
  });
  it("no report yet → '—'; truncated/partial JSON → 'partial' (mid-write is expected live)", () => {
    const d = tmp();
    writeFileSync(join(d, "mjs-migration.terminal.json"), '{"verdict":"DO'); // torn write
    expect(reportVerdict(d, "never-ran", "terminal")).toBe("—");
    expect(reportVerdict(d, "mjs-migration", "terminal")).toBe("partial");
  });
});

describe("fleet-watch RUN/idle decision (log basename ↔ claim key join)", () => {
  it("an active claim for the slot marks its log 🟢RUN: basename parse matches `lane.version`", () => {
    const store = defaultStore(tmp());
    acquireClaim(store, { lane: "typescript-core", version: "terminal", tab: "fleet-typescript-core-terminal", pid: 1 });
    const activeKey = new Set(activeClaims(readClaims(store), Date.now()).map((c) => `${c.lane}.${c.version}`));
    const [stream, slot] = "typescript-core.terminal.log".replace(/\.log$/, "").split(".");
    expect(activeKey.has(`${stream}.${slot}`)).toBe(true);   // 🟢RUN
    expect(activeKey.has("shell-harden.iterm2")).toBe(false); // other slot stays ⚪idle
  });
  it("an expired (TTL-blown) claim reads as ⚪idle — dead workers don't show as running", () => {
    const store = defaultStore(tmp());
    const T0 = 1_700_000_000_000;
    acquireClaim(store, { lane: "shell-harden", version: "iterm2", tab: "t", pid: 1, ttlMs: 1000, now: T0 });
    const activeKey = new Set(activeClaims(readClaims(store), T0 + 5000).map((c) => `${c.lane}.${c.version}`));
    expect(activeKey.has("shell-harden.iterm2")).toBe(false);
  });
});
