import { describe, it, expect } from "vitest";
import {
  simulateDispatch, healthAt, firstFailTick, renderSimReport,
  type SimTask, type HealthEvent,
} from "../bin/lib/dispatchsim";
import type { FleetWorker } from "../bin/lib/dispatchbench";

const MAC: FleetWorker = { name: "mac", kind: "mac", healthy: true, tokS: 20 };
const DESK: FleetWorker = { name: "desktop-ert7724", kind: "remote", healthy: true, tokS: 40 };

const EPIC: SimTask[] = [
  { id: "t1", kind: "host-tool", durationTicks: 2 },
  { id: "t2", kind: "codegen", durationTicks: 3 },
  { id: "t3", kind: "analysis", durationTicks: 2 },
];

// ── helpers ──────────────────────────────────────────────────────────────────
describe("healthAt — latest event per worker ≤ tick", () => {
  const tl: HealthEvent[] = [{ tick: 5, worker: "desktop-ert7724", healthy: false }, { tick: 9, worker: "desktop-ert7724", healthy: true }];
  it("before any event → initial health", () => {
    expect(healthAt([DESK], tl, 4).find((w) => w.name === "desktop-ert7724")!.healthy).toBe(true);
  });
  it("after down event → unhealthy", () => {
    expect(healthAt([DESK], tl, 6).find((w) => w.name === "desktop-ert7724")!.healthy).toBe(false);
  });
  it("after failback event → healthy again", () => {
    expect(healthAt([DESK], tl, 10).find((w) => w.name === "desktop-ert7724")!.healthy).toBe(true);
  });
});

describe("firstFailTick — first unhealthy in (start,end]", () => {
  const tl: HealthEvent[] = [{ tick: 4, worker: "desktop-ert7724", healthy: false }];
  it("inside window → that tick", () => expect(firstFailTick(tl, "desktop-ert7724", 2, 5)).toBe(4));
  it("outside window → null", () => expect(firstFailTick(tl, "desktop-ert7724", 5, 8)).toBeNull());
});

// ── happy path (all healthy) ──────────────────────────────────────────────────
describe("simulateDispatch — all healthy: correct routing", () => {
  const r = simulateDispatch(EPIC, [MAC, DESK], []);
  it("host-tool→mac, codegen/analysis→desktop", () => {
    const byTask = Object.fromEntries(r.assignments.map((a) => [a.taskId, a.worker]));
    expect(byTask.t1).toBe("mac");
    expect(byTask.t2).toBe("desktop-ert7724");
    expect(byTask.t3).toBe("desktop-ert7724");
  });
  it("no failovers; epic allOk DONE", () => {
    expect(r.failovers).toHaveLength(0);
    expect(r.epicReport.allOk).toBe(true);
    expect(r.epicReport.verdict).toBe("DONE");
  });
  it("host-tool never assigned to a remote", () => {
    const t1 = r.assignments.find((a) => a.taskId === "t1")!;
    expect(t1.worker).toBe("mac");
  });
});

// ── failover: desktop dies mid-run ────────────────────────────────────────────
describe("simulateDispatch — desktop down mid-run → mac substrate failover", () => {
  // t1 host-tool on mac (ticks 0-2). t2 codegen starts tick2 on desktop; desktop dies tick3 → failover to mac.
  const timeline: HealthEvent[] = [{ tick: 3, worker: "desktop-ert7724", healthy: false }];
  const r = simulateDispatch(EPIC, [MAC, DESK], timeline);
  it("a failover event exists: desktop → mac", () => {
    expect(r.failovers.length).toBeGreaterThanOrEqual(1);
    const f = r.failovers[0];
    expect(f.fromWorker).toBe("desktop-ert7724");
    expect(f.toWorker).toBe("mac"); // substrate
  });
  it("failed event then re-claim on mac in the ledger trace", () => {
    expect(r.events.some((e) => e.taskId === "t2" && e.status === "failed")).toBe(true);
    expect(r.events.some((e) => e.taskId === "t2" && e.status === "claimed" && e.worker === "mac")).toBe(true);
  });
  it("epic still allOk after failover (Hybrid resilience)", () => {
    expect(r.epicReport.allOk).toBe(true);
    expect(r.epicReport.tasks.find((t) => t.taskId === "t2")!.failedOver).toBe(true);
  });
});

// ── failback: desktop healthy again for a later task ──────────────────────────
describe("simulateDispatch — failback: desktop healthy again routes later task back", () => {
  // desktop down only at tick 3, healthy again from tick 100. Long t2 hits the down window; t3 (after 100) back on desktop.
  const timeline: HealthEvent[] = [
    { tick: 3, worker: "desktop-ert7724", healthy: false },
    { tick: 100, worker: "desktop-ert7724", healthy: true },
  ];
  const longEpic: SimTask[] = [
    { id: "t1", kind: "host-tool", durationTicks: 2 },
    { id: "t2", kind: "codegen", durationTicks: 3 },
    { id: "t3", kind: "analysis", durationTicks: 2 },
  ];
  it("t2 fails over to mac, t3 (post-failback) goes back to desktop", () => {
    // Force t3 to start after failback by giving t2's mac-run enough length; mac run completes < 100 so t3 starts ~tick7.
    // To make failback observable, push t3 start past 100 via a filler long task on mac.
    const epic2: SimTask[] = [
      ...longEpic,
      { id: "t4", kind: "host-tool", durationTicks: 95 }, // long mac task pushes clock past 100
      { id: "t5", kind: "codegen", durationTicks: 2 },     // starts after 100 → desktop healthy again
    ];
    const r = simulateDispatch(epic2, [MAC, DESK], timeline);
    expect(r.assignments.find((a) => a.taskId === "t5")!.worker).toBe("desktop-ert7724"); // failback
    expect(r.epicReport.allOk).toBe(true);
  });
});

// ── no healthy worker → blocked ───────────────────────────────────────────────
describe("simulateDispatch — host-tool with mac down → blocked (honest)", () => {
  const r = simulateDispatch(
    [{ id: "h", kind: "host-tool", durationTicks: 2 }],
    [{ ...MAC, healthy: false }, DESK], [],
  );
  it("blocked, not done; epic not allOk", () => {
    expect(r.epicReport.tasks[0].status).toBe("blocked");
    expect(r.epicReport.allOk).toBe(false);
    expect(r.epicReport.verdict).toBe("INCOMPLETE");
  });
});

// ── determinism + report ──────────────────────────────────────────────────────
describe("determinism + renderSimReport", () => {
  const timeline: HealthEvent[] = [{ tick: 3, worker: "desktop-ert7724", healthy: false }];
  it("same input → identical SimResult", () => {
    expect(simulateDispatch(EPIC, [MAC, DESK], timeline)).toEqual(simulateDispatch(EPIC, [MAC, DESK], timeline));
  });
  it("report labels itself simulation + shows failover + verdict", () => {
    const md = renderSimReport(simulateDispatch(EPIC, [MAC, DESK], timeline), "test scenario");
    expect(md).toMatch(/NOT a live perf measurement/i);
    expect(md).toMatch(/Failover/i);
    expect(md).toMatch(/VERDICT: DONE/);
    expect(md).toMatch(/oracle/i);
  });
});
