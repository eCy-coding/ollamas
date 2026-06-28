/**
 * tests/cli-remote-dispatch.test.ts — PURE (zero IO) conformance test for the e2e e.1 lane.
 *
 * Asserts the two cli pure cores the distributed-dispatch flow is built on, against the
 * orchestration ORACLE (SPEC_DISPATCH §4 routing rules + INVARIANTS I1–I5/I13 + DISPATCH_SIM
 * golden trace). No socket/disk — folds canned inputs only.
 *
 *   - cli/lib/dispatch-ledger.ts : assignWorker routing (host-tool→mac, codegen→remote,
 *       remote-down→mac substrate failover) + foldLedger LWW.
 *   - cli/lib/remote-agent.ts    : parseDispatchReport demoSuspected + verdict folding.
 *
 * This is the green gate the e2e (dispatch.e2e.test.ts) sits on top of: the live test may
 * skip when the fleet is down, but these invariants must hold deterministically, always.
 */
import { describe, it, expect } from "vitest";
import {
  assignWorker,
  foldLedger,
  type LedgerEvent,
  type DispatchTask,
  type FleetWorker,
} from "../cli/lib/dispatch-ledger";
import {
  parseDispatchReport,
  type DispatchEvent,
} from "../cli/lib/remote-agent";

const J = (x: unknown) => JSON.stringify(x);

// DISPATCH_SIM.md scenario fleet: mac control plane + desktop-ert7724 GPU worker.
const macUp: FleetWorker = { name: "mac", kind: "mac", healthy: true, tokS: 10 };
const macDown: FleetWorker = { name: "mac", kind: "mac", healthy: false, tokS: 10 };
const desktopUp: FleetWorker = { name: "desktop-ert7724", kind: "remote", healthy: true, tokS: 40 };
const desktopDown: FleetWorker = { name: "desktop-ert7724", kind: "remote", healthy: false, tokS: 40 };

// ── assignWorker routing (SPEC_DISPATCH §4, INVARIANTS I3/I4) ───────────────────────
describe("assignWorker — routing reproduces the DISPATCH_SIM golden assignment", () => {
  it("host-tool → mac control plane only (I4 safety)", () => {
    const r = assignWorker({ id: "t1", kind: "host-tool" }, [macUp, desktopUp]);
    expect(r.worker).toBe("mac");
    expect(r.reason).toMatch(/mac/);
  });

  it("host-tool with mac DOWN → unassignable (never routes to a healthy remote)", () => {
    const r = assignWorker({ id: "t4", kind: "host-tool" }, [macDown, desktopUp]);
    expect(r.worker).toBe(null);
  });

  it("codegen → healthy remote (highest tok/s), not the mac", () => {
    const r = assignWorker({ id: "t2", kind: "codegen" }, [macUp, desktopUp]);
    expect(r.worker).toBe("desktop-ert7724");
    expect(r.reason).toMatch(/remote/);
  });

  it("codegen, remote DOWN → mac substrate failover (Hybrid fallback)", () => {
    const r = assignWorker({ id: "t2", kind: "codegen" }, [macUp, desktopDown]);
    expect(r.worker).toBe("mac"); // substrate failover — the proven Hybrid fallback
    expect(r.reason).toMatch(/substrate|failover/);
  });

  it("analysis, no healthy remote → mac substrate failover", () => {
    const r = assignWorker({ id: "t3", kind: "analysis" }, [macUp]);
    expect(r.worker).toBe("mac");
  });

  it("nothing healthy → null (totality, no throw)", () => {
    expect(assignWorker({ id: "x", kind: "codegen" }, [macDown, desktopDown]).worker).toBe(null);
    expect(assignWorker({ id: "x", kind: "codegen" }, []).worker).toBe(null);
  });

  it("determinism: same input → structurally identical assignment (I2)", () => {
    const task: DispatchTask = { id: "t2", kind: "codegen" };
    const fleet = [macUp, desktopUp];
    expect(J(assignWorker(task, fleet))).toBe(J(assignWorker(task, fleet)));
  });

  it("reproduces the full DISPATCH_SIM first-hop assignment table", () => {
    const fleet = [macUp, desktopUp];
    const expected: Array<[DispatchTask["kind"], string]> = [
      ["host-tool", "mac"],            // t1
      ["codegen", "desktop-ert7724"],  // t2
      ["analysis", "desktop-ert7724"], // t3 — desktop still up at first hop
      ["host-tool", "mac"],            // t4
      ["codegen", "desktop-ert7724"],  // t5
    ];
    for (const [kind, worker] of expected) {
      expect(assignWorker({ id: kind, kind }, fleet).worker).toBe(worker);
    }
  });
});

// ── foldLedger LWW (INVARIANTS I13) ─────────────────────────────────────────────────
describe("foldLedger — LWW (ts→fence→worker), permutation-invariant", () => {
  const mk = (ts: number, taskId: string, worker: string, fence: number, status: LedgerEvent["status"] = "claimed"): LedgerEvent =>
    ({ ts, taskId, worker, status, ttlMs: 1000, fence });

  it("last-writer-wins picks the latest (ts then fence then worker)", () => {
    // The t2 failover sequence from DISPATCH_SIM: claimed@desktop → failed → claimed@mac → done@mac.
    const events: LedgerEvent[] = [
      mk(2000, "t2", "desktop-ert7724", 1, "claimed"),
      mk(3000, "t2", "desktop-ert7724", 1, "failed"),
      mk(3000, "t2", "mac", 2, "claimed"),       // same ts, higher fence → wins over the failed
      mk(6000, "t2", "mac", 2, "done"),          // latest ts → final state
    ];
    expect(foldLedger(events).get("t2")).toEqual(mk(6000, "t2", "mac", 2, "done"));
  });

  it("permutation-invariant under unique (ts,fence,worker)", () => {
    const events: LedgerEvent[] = [
      mk(1, "t1", "mac", 1, "done"),
      mk(2, "t2", "desktop-ert7724", 1, "claimed"),
      mk(3, "t2", "mac", 2, "done"),
      mk(4, "t3", "mac", 1, "done"),
    ];
    const base = foldLedger(events);
    const rev = foldLedger([...events].reverse());
    const shuf = foldLedger([...events].sort((a, b) => a.worker.localeCompare(b.worker)));
    for (const p of [rev, shuf]) {
      expect(p.size).toBe(base.size);
      for (const [k, v] of base) expect(J(p.get(k))).toBe(J(v));
    }
  });
});

// ── parseDispatchReport demoSuspected + verdict (remote-agent oracle parity) ─────────
describe("parseDispatchReport — demoSuspected + verdict fold (agent-dispatch.mjs parity)", () => {
  const step = (n: number, tool: string, ok: boolean, result = "ok"): DispatchEvent =>
    ({ type: "step", stepNum: n, tool, ok, result });

  it("real run with a VERDICT: DONE final message → verdict DONE, files captured, not demo", () => {
    const events: DispatchEvent[] = [
      { type: "step", stepNum: 1, tool: "write_host_file", ok: true, args: { path: "/abs/out.py" }, result: "wrote" },
      step(2, "macos_terminal", true, "42\n"),
      { type: "done", text: "VERDICT: DONE printed 42" },
    ];
    const r = parseDispatchReport(events, "desktop-ert7724:8090");
    expect(r.verdict).toBe("DONE");
    expect(r.files).toEqual(["/abs/out.py"]);
    expect(r.demoSuspected).toBe(false);
    expect(r.steps).toHaveLength(2);
    expect(r.host).toBe("desktop-ert7724:8090");
  });

  it("BLOCKED final message → verdict BLOCKED", () => {
    const events: DispatchEvent[] = [
      step(1, "grep_search", true),
      { type: "message", text: "VERDICT: BLOCKED tool refused" },
    ];
    expect(parseDispatchReport(events).verdict).toBe("BLOCKED");
  });

  it("zero tool steps + chatty message + no errors → demoSuspected, verdict INCOMPLETE", () => {
    const events: DispatchEvent[] = [
      { type: "message", text: "Sure, I can help with that. Here's how you would..." },
      { type: "done", text: "let me know if you need more." },
    ];
    const r = parseDispatchReport(events);
    expect(r.demoSuspected).toBe(true);
    expect(r.verdict).toBe("INCOMPLETE"); // a demo run is never DONE/OK (evidence law)
  });

  it("real steps, all ok, no verdict line → verdict OK (not demo)", () => {
    const r = parseDispatchReport([step(1, "read_file", true), step(2, "macos_terminal", true)]);
    expect(r.demoSuspected).toBe(false);
    expect(r.verdict).toBe("OK");
  });

  it("error event → recorded, verdict INCOMPLETE, not demo", () => {
    const r = parseDispatchReport([{ type: "error", message: "connection reset" }]);
    expect(r.errors).toEqual(["connection reset"]);
    expect(r.demoSuspected).toBe(false);
    expect(r.verdict).toBe("INCOMPLETE");
  });

  it("totality: empty / malformed input never throws", () => {
    expect(() => parseDispatchReport([])).not.toThrow();
    expect(() => parseDispatchReport([null as any, 7 as any, {}])).not.toThrow();
    expect(parseDispatchReport([]).verdict).toBe("INCOMPLETE");
  });
});
