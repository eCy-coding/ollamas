// v7 — pure remediation planner + backoff (no exec; deterministic).
import { describe, it, expect } from "vitest";
import { planRemediation, retryWithBackoff, backoffDelays } from "../../bin/host-bridge/lib/remediation.mjs";

const ids = (plan: any[]) => plan.map((a) => a.id);

describe("planRemediation", () => {
  it("healthy bridge → no actions (idempotent)", () => {
    expect(planRemediation({ bridge: { ok: true }, app: { ok: true } })).toEqual([]);
  });

  it("bridge down + stale pidfile → clean_pid before restart", () => {
    const plan = planRemediation({ bridge: { ok: false }, pidFile: { exists: true, alive: false } });
    expect(ids(plan)).toEqual(["clean_pid", "restart_bridge"]);
  });

  it("bridge down + hung node on 7345 → safe kill then restart", () => {
    const plan = planRemediation({ bridge: { ok: false }, port7345: { occupied: true, byNode: true } });
    expect(ids(plan)).toEqual(["kill_7345_node", "restart_bridge"]);
    expect(plan.every((a) => a.sideEffect !== undefined)).toBe(true);
  });

  it("port 7345 held by NON-node → never kill, report + no restart", () => {
    const plan = planRemediation({ bridge: { ok: false }, port7345: { occupied: true, byNode: false } });
    expect(ids(plan)).toEqual(["port_blocked"]);
    expect(plan[0].sideEffect).toBe(false);
  });

  it("launchd-managed bridge down → kickstart instead of script restart", () => {
    const plan = planRemediation({ bridge: { ok: false }, launchdManaged: true });
    expect(ids(plan)).toEqual(["plist_kickstart"]);
  });

  it("app down (docker) → report only, no side effect", () => {
    const plan = planRemediation({ bridge: { ok: true }, app: { ok: false } });
    expect(ids(plan)).toEqual(["app_report"]);
    expect(plan[0].sideEffect).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("returns on first success without sleeping", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const r = await retryWithBackoff(() => { calls++; return "ok"; }, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("retries with exponential backoff then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const r = await retryWithBackoff(
      () => { calls++; if (calls < 3) throw new Error("down"); return "healed"; },
      { retries: 5, minTimeout: 1000, factor: 2, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(r).toBe("healed");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]); // 2 retries before 3rd success
  });

  it("throws the last error after exhausting retries", async () => {
    let calls = 0;
    await expect(retryWithBackoff(
      () => { calls++; throw new Error("still down"); },
      { retries: 2, sleep: async () => {} },
    )).rejects.toThrow("still down");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("caps delay at maxTimeout", () => {
    expect(backoffDelays({ retries: 6, minTimeout: 1000, factor: 2, maxTimeout: 8000 }))
      .toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });
});
