/**
 * Pure-core tests for cli/lib/dispatch-ledger.ts — zero IO.
 * Adapts the assignWorker invariant cases from orchestration/tests/dispatch-invariants.test.ts
 * (totality, host-tool→never-remote/safety, determinism, soundness, thrash-guard) plus
 * foldLedger LWW permutation-invariance (I13). Hand-written cases keep the cli zero-dep (no proptest).
 */
import { describe, it, expect } from "vitest";
import {
  parseLedger,
  foldLedger,
  isStale,
  isActive,
  nextFence,
  assignWorker,
} from "../cli/lib/dispatch-ledger";
import type { LedgerEvent, DispatchTask, FleetWorker } from "../cli/lib/dispatch-ledger";

const J = (x: unknown) => JSON.stringify(x);

// ── small generative enumeration (deterministic, no proptest dep) ──────────────────
const WORKER_NAMES = ["mac", "desktop-ert7724", "box-a", "box-b"] as const;
const KINDS = ["mac", "remote"] as const;
const TASK_KINDS = ["codegen", "analysis", "host-tool", "google-grounded"] as const;

/** Deterministic worker-set enumeration: a handful of hand-curated + small cartesian fixtures. */
function fixtureWorkerSets(): FleetWorker[][] {
  const sets: FleetWorker[][] = [
    [],
    [{ name: "mac", kind: "mac", healthy: true, tokS: 10 }],
    [{ name: "mac", kind: "mac", healthy: false, tokS: 10 }],
    [{ name: "box-a", kind: "remote", healthy: true, tokS: 30 }],
    [{ name: "box-a", kind: "remote", healthy: false, tokS: 30 }],
    [
      { name: "mac", kind: "mac", healthy: true, tokS: 10 },
      { name: "box-a", kind: "remote", healthy: true, tokS: 30 },
      { name: "box-b", kind: "remote", healthy: true, tokS: 50 },
    ],
    [
      { name: "mac", kind: "mac", healthy: true, tokS: 10 },
      { name: "box-a", kind: "remote", healthy: false, tokS: 30 },
    ],
    [
      // two healthy macs — only the FIRST is the control plane (I5 caveat)
      { name: "mac", kind: "mac", healthy: true, tokS: 10 },
      { name: "desktop-ert7724", kind: "mac", healthy: true, tokS: 20 },
      { name: "box-a", kind: "remote", healthy: true, tokS: 40 },
    ],
    [
      { name: "box-a", kind: "remote", healthy: true, tokS: 30 },
      { name: "box-b", kind: "remote", healthy: true, tokS: 30 }, // tok/s tie → name tie-break
    ],
  ];
  return sets;
}

function allTasks(): DispatchTask[] {
  return TASK_KINDS.map((k, i) => ({ id: "t" + i, kind: k }));
}

// ── assignWorker invariants I1–I5 ─────────────────────────────────────────────────
describe("assignWorker — I1 totality · I2 determinism · I3 soundness · I4 safety · I5 thrash-guard", () => {
  it("I1/I2/I3/I4: well-formed, deterministic, sound, host-tool-safe over all fixtures", () => {
    for (const task of allTasks()) {
      for (const workers of fixtureWorkerSets()) {
        const r = assignWorker(task, workers);
        // I1 totality: shape is {worker: string|null, reason: string}
        expect(typeof r.worker === "string" || r.worker === null).toBe(true);
        expect(typeof r.reason).toBe("string");
        // I2 determinism
        expect(J(assignWorker(task, workers))).toBe(J(r));
        if (r.worker !== null) {
          // I3 soundness: a non-null pick is a healthy worker that exists
          expect(workers.some((x) => x.name === r.worker && x.healthy)).toBe(true);
          // I4 safety: host-tool never on a remote — only a healthy mac
          if (task.kind === "host-tool") {
            expect(workers.some((x) => x.name === r.worker && x.kind === "mac" && x.healthy)).toBe(true);
          }
        }
      }
    }
  });

  it("I4: host-tool → never routes to a remote (explicit)", () => {
    const workers: FleetWorker[] = [
      { name: "mac", kind: "mac", healthy: true, tokS: 5 },
      { name: "box-a", kind: "remote", healthy: true, tokS: 99 },
    ];
    expect(assignWorker({ id: "h", kind: "host-tool" }, workers).worker).toBe("mac");
    // mac down → host-tool unassignable even with a healthy remote
    const macDown: FleetWorker[] = [{ name: "box-a", kind: "remote", healthy: true, tokS: 99 }];
    expect(assignWorker({ id: "h", kind: "host-tool" }, macDown).worker).toBe(null);
  });

  it("codegen → highest-tok/s healthy remote; remote down → mac substrate failover; none → null", () => {
    const full: FleetWorker[] = [
      { name: "mac", kind: "mac", healthy: true, tokS: 10 },
      { name: "box-a", kind: "remote", healthy: true, tokS: 30 },
      { name: "box-b", kind: "remote", healthy: true, tokS: 50 },
    ];
    expect(assignWorker({ id: "c", kind: "codegen" }, full).worker).toBe("box-b"); // highest tok/s
    const noRemote: FleetWorker[] = [{ name: "mac", kind: "mac", healthy: true, tokS: 10 }];
    expect(assignWorker({ id: "c", kind: "codegen" }, noRemote).worker).toBe("mac"); // failover
    expect(assignWorker({ id: "c", kind: "codegen" }, []).worker).toBe(null);
  });

  it("google-grounded → prefers the gemini-cli worker when healthy", () => {
    const withGemini: FleetWorker[] = [
      { name: "box-a", kind: "remote", healthy: true, tokS: 99 },
      { name: "gemini-cli", kind: "remote", healthy: true },
      { name: "mac", kind: "mac", healthy: true },
    ];
    expect(assignWorker({ id: "g", kind: "google-grounded" }, withGemini).worker).toBe("gemini-cli");
    // No gemini-cli worker → falls through to the normal GPU-remote path.
    const noGemini: FleetWorker[] = [
      { name: "box-a", kind: "remote", healthy: true, tokS: 99 },
      { name: "mac", kind: "mac", healthy: true },
    ];
    expect(assignWorker({ id: "g", kind: "google-grounded" }, noGemini).worker).toBe("box-a");
    // gemini-cli unhealthy → not chosen.
    const geminiDown: FleetWorker[] = [
      { name: "gemini-cli", kind: "remote", healthy: false },
      { name: "mac", kind: "mac", healthy: true },
    ];
    expect(assignWorker({ id: "g", kind: "google-grounded" }, geminiDown).worker).toBe("mac");
  });

  it("gemini-cli is NOT preferred for plain codegen (competes as a tok/s=0 remote)", () => {
    const workers: FleetWorker[] = [
      { name: "box-a", kind: "remote", healthy: true, tokS: 50 },
      { name: "gemini-cli", kind: "remote", healthy: true },
    ];
    expect(assignWorker({ id: "c", kind: "codegen" }, workers).worker).toBe("box-a");
  });

  it("tok/s tie → deterministic name tie-break", () => {
    const tie: FleetWorker[] = [
      { name: "box-b", kind: "remote", healthy: true, tokS: 30 },
      { name: "box-a", kind: "remote", healthy: true, tokS: 30 },
    ];
    expect(assignWorker({ id: "c", kind: "analysis" }, tie).worker).toBe("box-a");
  });

  it("I5 thrash-guard: if `current` ∈ eligible set, the pick is unchanged", () => {
    for (const task of allTasks()) {
      for (const workers of fixtureWorkerSets()) {
        const healthy = workers.filter((w) => w.healthy);
        const mac = healthy.find((w) => w.kind === "mac") || null;
        const remotes = healthy.filter((w) => w.kind === "remote");
        const eligibleNames = task.kind === "host-tool"
          ? (mac ? [mac.name] : [])
          : [...remotes.map((w) => w.name), ...(mac ? [mac.name] : [])];
        for (const current of WORKER_NAMES) {
          if (!eligibleNames.includes(current)) continue;
          expect(assignWorker(task, workers, { current }).worker).toBe(current);
        }
      }
    }
  });

  it("I5 caveat: a 2nd healthy mac is NOT eligible for host-tool → not kept", () => {
    const workers: FleetWorker[] = [
      { name: "mac", kind: "mac", healthy: true, tokS: 10 },
      { name: "desktop-ert7724", kind: "mac", healthy: true, tokS: 20 },
    ];
    // current = the 2nd mac is NOT the control plane → assignment falls to the first mac
    expect(assignWorker({ id: "h", kind: "host-tool" }, workers, { current: "desktop-ert7724" }).worker)
      .toBe("mac");
  });
});

// ── foldLedger LWW invariants (I13) ────────────────────────────────────────────────
describe("foldLedger — I13 LWW permutation-invariance · stale/fence helpers", () => {
  function mk(ts: number, taskId: string, worker: string, fence: number, status: LedgerEvent["status"] = "claimed"): LedgerEvent {
    return { ts, taskId, worker, status, ttlMs: 1000, fence };
  }

  it("LWW order ts→fence→worker picks the latest", () => {
    const events: LedgerEvent[] = [
      mk(1, "t1", "a", 1),
      mk(5, "t1", "b", 1),
      mk(5, "t1", "b", 2), // same ts, higher fence → wins
      mk(3, "t1", "c", 9),
    ];
    const f = foldLedger(events);
    expect(f.get("t1")).toEqual(mk(5, "t1", "b", 2));
  });

  it("permutation-invariance under unique (ts,fence,worker)", () => {
    const events: LedgerEvent[] = [
      mk(1, "t1", "a", 1),
      mk(2, "t2", "b", 1),
      mk(3, "t1", "c", 2),
      mk(2, "t2", "d", 3),
      mk(4, "t3", "a", 1, "done"),
    ];
    const f1 = foldLedger(events);
    const f2 = foldLedger([...events].reverse());
    const perms = [
      [...events].sort((a, b) => a.worker.localeCompare(b.worker)),
      [...events].sort((a, b) => b.ts - a.ts),
    ];
    for (const p of [f2, ...perms.map(foldLedger)]) {
      expect(p.size).toBe(f1.size);
      for (const [k, v] of f1) expect(J(p.get(k))).toBe(J(v));
    }
  });

  it("isStale / isActive respect ttl + status", () => {
    const e = mk(100, "t1", "a", 1, "claimed");
    expect(isActive(e, 150)).toBe(true);   // within ttl
    expect(isStale(e, 150)).toBe(false);
    expect(isActive(e, 1200)).toBe(false); // ttl exceeded
    expect(isStale(e, 1200)).toBe(true);
    const done = mk(100, "t1", "a", 1, "done");
    expect(isStale(done, 1200)).toBe(false); // terminal never stale
    expect(isActive(done, 150)).toBe(false);
  });

  it("nextFence is monotonic per taskId", () => {
    const events: LedgerEvent[] = [mk(1, "t1", "a", 1), mk(2, "t1", "b", 4), mk(3, "t2", "c", 9)];
    expect(nextFence(events, "t1")).toBe(5);
    expect(nextFence(events, "t2")).toBe(10);
    expect(nextFence(events, "tX")).toBe(1); // unseen → 1
  });

  it("parseLedger skips corrupt / missing-field lines (graceful)", () => {
    const jsonl = [
      JSON.stringify(mk(1, "t1", "a", 1)),
      "{ not json",
      JSON.stringify({ ts: 2, taskId: "t2" }),          // missing fields
      JSON.stringify({ ts: 3, taskId: "t3", worker: "x", status: "bogus", ttlMs: 1 }), // bad status
      JSON.stringify(mk(4, "t4", "b", 2, "running")),
      "",
    ].join("\n");
    const parsed = parseLedger(jsonl);
    expect(parsed.map((e) => e.taskId)).toEqual(["t1", "t4"]);
    expect(parsed[1].fence).toBe(2);
  });
});
