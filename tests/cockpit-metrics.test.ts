import { describe, it, expect } from "vitest";
import type { CpuInfo } from "node:os";
import { coreUtilization, activitySummary } from "../server/cockpit-metrics";

// Build a CpuInfo with given idle + nonIdle. total = idle + nonIdle (spread over user/sys).
const core = (idle: number, nonIdle: number): CpuInfo => ({
  model: "test",
  speed: 0,
  times: { user: nonIdle, nice: 0, sys: 0, idle, irq: 0 },
});

const NOW = 1_000_000_000_000;

describe("coreUtilization", () => {
  it("computes 50.0 busy when idleDelta is half of totalDelta", () => {
    // prev: idle=100, total=200 (user=100). now: idle=200, total=400 (user=200).
    // idleDelta=100, totalDelta=200 → 50% idle → 50.0 busy.
    const prev = [core(100, 100)];
    const now = [core(200, 200)];
    expect(coreUtilization(prev, now)).toEqual([50.0]);
  });

  it("computes 75.0 busy (idleDelta 25% of totalDelta)", () => {
    // prev idle=100 total=200; now idle=150 total=400 → idleDelta=50 totalDelta=200 → 25% idle → 75 busy
    const prev = [core(100, 100)];
    const now = [core(150, 250)];
    expect(coreUtilization(prev, now)).toEqual([75.0]);
  });

  it("returns 0 for a fully-idle core (all delta is idle)", () => {
    const prev = [core(100, 100)];
    const now = [core(300, 100)]; // idleDelta=200, totalDelta=200 → 0 busy
    expect(coreUtilization(prev, now)).toEqual([0]);
  });

  it("handles totalDelta <= 0 as 0", () => {
    const prev = [core(100, 100)];
    const now = [core(100, 100)]; // no delta
    expect(coreUtilization(prev, now)).toEqual([0]);
  });

  it("handles mismatched lengths (uses the shorter)", () => {
    const prev = [core(100, 100), core(100, 100)];
    const now = [core(200, 200)];
    expect(coreUtilization(prev, now)).toEqual([50.0]);
  });

  it("returns [] for empty inputs", () => {
    expect(coreUtilization([], [core(1, 1)])).toEqual([]);
    expect(coreUtilization([core(1, 1)], [])).toEqual([]);
    expect(coreUtilization(undefined as any, undefined as any)).toEqual([]);
  });
});

describe("activitySummary", () => {
  it("counts recentRuns within 1h, excludes older", () => {
    const events = [
      { ts: NOW - 1000 },            // recent
      { ts: NOW - 3_500_000 },       // within 1h
      { ts: NOW - 3_700_000 },       // older than 1h → excluded
    ];
    const r = activitySummary([], events, NOW);
    expect(r.recentRuns).toBe(2);
  });

  it("lastActivityAgoSec from newest of sessions + events", () => {
    const sessions = [{ updatedAt: NOW - 50_000 }];
    const events = [{ ts: NOW - 10_000 }]; // newer → 10s ago
    const r = activitySummary(sessions, events, NOW);
    expect(r.lastActivityAgoSec).toBe(10);
    expect(r.sessionCount).toBe(1);
  });

  it("uses session when it is newer than events", () => {
    const sessions = [{ updatedAt: NOW - 5_000 }];
    const events = [{ ts: NOW - 60_000 }];
    const r = activitySummary(sessions, events, NOW);
    expect(r.lastActivityAgoSec).toBe(5);
  });

  it("empties → {sessionCount:0, recentRuns:0, lastActivityAgoSec:null}", () => {
    expect(activitySummary([], [], NOW)).toEqual({
      sessionCount: 0,
      recentRuns: 0,
      lastActivityAgoSec: null,
    });
    expect(activitySummary(null, undefined, NOW)).toEqual({
      sessionCount: 0,
      recentRuns: 0,
      lastActivityAgoSec: null,
    });
  });

  it("ignores invalid timestamps", () => {
    const r = activitySummary(
      [{ updatedAt: "not-a-date" }],
      [{ ts: undefined }],
      NOW,
    );
    expect(r.sessionCount).toBe(1);
    expect(r.recentRuns).toBe(0);
    expect(r.lastActivityAgoSec).toBeNull();
  });
});
