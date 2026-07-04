// fleet-conduct seams — tests what bin/fleet-conduct.ts composes: the per-report gate, the claims-ledger
// IO round-trip behind snapshot()'s liveKeys, and the --stop kill-switch fold — without spawning wrappers
// or reading ~/.llm-mission-control. extractOneProposal's shape cases live in fleet-conduct-lib.test.ts
// and are NOT repeated; only the conductor-specific composition (raw j.messages of mixed types) is here.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultStore, readClaims, activeClaims, acquireClaim, closeClaim } from "../bin/lib/claims";
import { extractOneProposal } from "../bin/lib/fleet-conduct-lib";

let dir = "";
const tmpStore = () => { dir = mkdtempSync(join(tmpdir(), "fleet-conduct-")); return defaultStore(dir); };
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

interface WorkerReport { stream: string; slot: string; verdict?: string; steps?: number; demoSuspected?: boolean; proposal?: string; error?: string; }
/** Reproduce main()'s gate: DONE/OK + real steps + not demo + a non-empty proposal (evidence-law). */
function gate(r: WorkerReport): { ok: boolean; reason: string } {
  if (r.error) return { ok: false, reason: r.error.slice(0, 60) };
  if (r.demoSuspected) return { ok: false, reason: "demo-suspected (steps=0, prose only)" };
  if (!(r.steps && r.steps > 0)) return { ok: false, reason: "no tool steps" };
  if (r.verdict !== "DONE" && r.verdict !== "OK") return { ok: false, reason: `verdict=${r.verdict ?? "?"}` };
  if (!r.proposal || r.proposal.length < 20) return { ok: false, reason: "no proposal content" };
  return { ok: true, reason: `${r.verdict} · ${r.steps} steps · proposal ${r.proposal.length}c` };
}

describe("fleet-conduct gate (evidence-law fold)", () => {
  const base: WorkerReport = { stream: "s", slot: "terminal", verdict: "DONE", steps: 3, proposal: "## Change: a real, long-enough proposal body" };
  it("gated: DONE + steps>0 + real proposal", () => {
    expect(gate(base).ok).toBe(true);
  });
  it("stricter than the worker's self-gate: a zero-step PROPOSE run is rejected here", () => {
    // fleet-agent gates zero-step DONE runs (proposal is text); the CONDUCTOR demands tool evidence.
    expect(gate({ ...base, steps: 0 })).toEqual({ ok: false, reason: "no tool steps" });
  });
  it("demo-suspected and parse-error halves are rejected with their reason", () => {
    expect(gate({ ...base, demoSuspected: true }).ok).toBe(false);
    expect(gate({ ...base, error: "report parse error / partial" }).reason).toContain("parse error");
  });
  it("short proposal (<20c) is not evidence", () => {
    expect(gate({ ...base, proposal: "## Change: x" })).toEqual({ ok: false, reason: "no proposal content" });
  });
});

describe("fleet-conduct claims round-trip (snapshot liveKeys + convergence input)", () => {
  it("an acquired fleet claim appears as `lane.version` — the key snapshot() matches reports against", () => {
    const store = tmpStore();
    const r = acquireClaim(store, { lane: "typescript-core", version: "terminal", tab: "fleet-typescript-core-terminal", pid: 1 });
    expect(r.ok).toBe(true);
    const live = activeClaims(readClaims(store), Date.now());
    expect(live.map((c) => `${c.lane}.${c.version}`)).toEqual(["typescript-core.terminal"]); // convergence blocked while live
  });
  it("a second worker on the same stream.slot collides (redispatch waits instead of double-running)", () => {
    const store = tmpStore();
    acquireClaim(store, { lane: "shell-harden", version: "iterm2", tab: "tabA", pid: 1 });
    const dup = acquireClaim(store, { lane: "shell-harden", version: "iterm2", tab: "tabB", pid: 2 });
    expect(dup.ok).toBe(false);
    expect(dup.collision?.tab).toBe("tabA");
  });
  it("kill-switch fold: closeClaim(released) on every active claim empties the ledger view", () => {
    const store = tmpStore();
    acquireClaim(store, { lane: "typescript-core", version: "terminal", tab: "t1", pid: 1 });
    acquireClaim(store, { lane: "errors-resilience", version: "iterm2", tab: "t2", pid: 2 });
    const live = activeClaims(readClaims(store), Date.now());
    expect(live).toHaveLength(2);
    // exactly killSwitch()'s loop: release each live claim under the conductor's tab identity
    for (const c of live) closeClaim(store, { lane: c.lane, version: c.version, tab: "fleet-conductor", pid: process.pid, status: "released" });
    expect(activeClaims(readClaims(store), Date.now())).toHaveLength(0); // convergence no longer blocked
  });
});

describe("fleet-conduct proposal extraction on RAW report messages (untrusted JSON)", () => {
  it("mixed-type messages arrays (numbers/objects/null) never throw and still find the marker", () => {
    const messages: unknown = [42, null, { note: "tool step blob" }, "## Change: y\nbody long enough here\nVERDICT: DONE"];
    const p = extractOneProposal(messages);
    expect(p.startsWith("## Change: y")).toBe(true);
    expect(gate({ stream: "s", slot: "terminal", verdict: "DONE", steps: 1, proposal: p }).ok).toBe(true);
  });
});
