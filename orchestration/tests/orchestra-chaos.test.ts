import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// D6 — end-to-end chaos: drive the REAL orchestra.ts CLI (child process) with hermetic test seams
// (ORCHESTRA_DRY skips all spawns/network; ORCHESTRA_FAKE_* force the observed signals) against an
// isolated ORCHESTRA_STATE_DIR, and assert the persisted resumable state — proving joker failover,
// bounded retry→escalate, and task lifecycle without needing a live ollama daemon.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const CLI = join(REPO, "orchestration", "bin", "orchestra.ts");

let stateDir: string;
// FAKE_DECISION=EXECUTE keeps these FSM/failover tests hermetic from the repo's live COUNCIL.json verdict.
const baseEnv = () => ({ ...process.env, ORCHESTRA_DRY: "1", ORCHESTRA_STATE_DIR: stateDir, ORCHESTRA_FAKE_DECISION: "EXECUTE" });
function run(args: string[], extra: Record<string, string> = {}): void {
  execFileSync(TSX, [CLI, ...args], { cwd: REPO, env: { ...baseEnv(), ...extra }, stdio: "ignore", timeout: 30_000 });
}
function state(): any { return JSON.parse(readFileSync(join(stateDir, "orchestra.json"), "utf8")); }

beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), "orchestra-chaos-")); });
afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

describe("orchestra CLI — boot + persist", () => {
  it("--once advances the FSM and writes resumable state", () => {
    run(["--once"]);
    expect(existsSync(join(stateDir, "orchestra.json"))).toBe(true);
    expect(state().phase).toBe("COUNCIL_DEBATE");
    expect(state().conductor_model).toBeTruthy();
  });

  it("two ticks reach BENCHMARK_VALIDATION", () => {
    run(["--once"]); run(["--once"]);
    expect(state().phase).toBe("BENCHMARK_VALIDATION");
  });
});

describe("chaos — joker failover", () => {
  it("conductor DOWN + healthy joker → swap + failover_count++", () => {
    run(["--once"], { ORCHESTRA_FAKE_HEALTHY: "0", ORCHESTRA_FAKE_HEALTHY_MODELS: "qwen3:8b" });
    const s = state();
    expect(s.conductor_model).toBe("qwen3:8b");
    expect(s.failover_count).toBe(1);
    expect(s.history.some((h: any) => h.note.includes("[FAILOVER]"))).toBe(true);
  });

  it("conductor DOWN + NO healthy alternative → no thrash (loop survives)", () => {
    run(["--once"], { ORCHESTRA_FAKE_HEALTHY: "0", ORCHESTRA_FAKE_HEALTHY_MODELS: "" });
    expect(state().failover_count).toBe(0); // never swapped to a dead model
  });
});

describe("chaos — bounded retry → ESCALATE (no infinite loop)", () => {
  it("persistent blocking signal escalates after RETRY_MAX", () => {
    // Force a permanently-broken gate: top tier RED, never converged → REPAIR loop.
    const chaos = { ORCHESTRA_FAKE_TIER: "RED", ORCHESTRA_FAKE_CONVERGED: "0" };
    for (let i = 0; i < 8; i++) run(["--once"], chaos);
    const s = state();
    expect(s.phase).toBe("ESCALATE");        // parked, not spinning
    expect(s.retry_count).toBeLessThanOrEqual(3);
  });
});

describe("G2 — council HOLD short-circuit", () => {
  it("council HOLD at COUNCIL_DEBATE (no task, no blocking) → holds at MONITORING, no repair", () => {
    run(["--once"]); // BOOTSTRAPPING → COUNCIL_DEBATE
    expect(state().phase).toBe("COUNCIL_DEBATE");
    run(["--once"], { ORCHESTRA_FAKE_DECISION: "HOLD" }); // council says HOLD → skip benchmark/repair
    expect(state().phase).toBe("MONITORING");
  });
  it("council HOLD is OVERRIDDEN by a queued task (user intent wins)", () => {
    run(["fix something"]);       // enqueue
    run(["--once"], { ORCHESTRA_FAKE_DECISION: "HOLD" }); // BOOTSTRAPPING→COUNCIL (dequeues)
    run(["--once"], { ORCHESTRA_FAKE_DECISION: "HOLD" }); // COUNCIL→BENCHMARK (hasTask overrides HOLD)
    expect(state().phase).toBe("BENCHMARK_VALIDATION");
  });
});

describe("chaos — task lifecycle", () => {
  it("enqueue → dequeue into current_task as the loop reopens", () => {
    run(["fix the thing"]);
    expect(state().pending_actions).toEqual(["fix the thing"]);
    for (let i = 0; i < 6; i++) run(["--once"], { ORCHESTRA_FAKE_TIER: "RED" });
    const s = state();
    expect(s.current_task).toBe("fix the thing");
    expect(s.pending_actions).toEqual([]);
  });
});
