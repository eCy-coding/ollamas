// Autonomous brain maintenance report builder (Tur 12). Pure decision logic — the
// four-lever framework (decay/eviction via sweep, merge+promote via consolidate,
// drift via health) collapsed into one report + exit-worthy action.
import { describe, it, expect } from "vitest";
import { buildMaintainReport } from "../brain-maintain";

describe("buildMaintainReport", () => {
  it("noop when nothing changed and no drift", () => {
    const r = buildMaintainReport({ sweep: { swept: 0 }, consolidate: { promoted: 0, merged: 0 }, health: { selfHitRate: 1, drift: false, probes: 8 } });
    expect(r.action).toBe("noop");
    expect(r.exitCode).toBe(0);
  });

  it("consolidated when work happened, still exit 0", () => {
    const r = buildMaintainReport({ sweep: { swept: 3 }, consolidate: { promoted: 2, merged: 1 }, health: { selfHitRate: 1, drift: false, probes: 8 } });
    expect(r.action).toBe("consolidated");
    expect(r.swept).toBe(3);
    expect(r.promoted).toBe(2);
    expect(r.merged).toBe(1);
    expect(r.exitCode).toBe(0);
  });

  it("drift dominates: re-embed suggested, exit 3 (cron alarm), even if work happened", () => {
    const r = buildMaintainReport({ sweep: { swept: 5 }, consolidate: { promoted: 0, merged: 0 }, health: { selfHitRate: 0.4, drift: true, probes: 8 } });
    expect(r.action).toBe("re-embed-suggested");
    expect(r.drift).toBe(true);
    expect(r.selfHitRate).toBe(0.4);
    expect(r.exitCode).toBe(3);
  });
});
