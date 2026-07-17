import { describe, it, expect } from "vitest";
import {
  trainPolicy, ucb1, selectActor, statsFromPolicy, allowedAction, learningCurve, emptyPolicy,
  AUTHORITY_RANK, DEFAULT_THRESHOLDS,
} from "../bin/lib/org-learn";
import { wilsonLower, type LedgerEntry, type Actor } from "../bin/lib/organization";

const NOW = "2026-07-18T03:00:00Z";

function outcomes(actorId: string, oks: boolean[], sig?: string): LedgerEntry[] {
  return oks.map((ok, i) => ({
    type: "outcome" as const, tier: ok ? ("episodic" as const) : ("learned" as const),
    ts: `2026-07-18T03:00:${String(i).padStart(2, "0")}Z`, taskId: `t${i}`, actorId, ok,
    summary: ok ? "ok" : "fail", ...(ok ? {} : sig ? { sig } : {}),
  }));
}

function actor(id: string, costRank = 0): Actor {
  return { id, kind: "model", role: id, duties: [], capabilities: ["code"], reportsTo: null, escalatesTo: null, costRank, knownFaults: [] };
}

describe("trainPolicy (curriculum ladder)", () => {
  it("insufficient evidence → propose (default responsibility)", () => {
    const p = trainPolicy(outcomes("a", [true, true]), { now: NOW });
    expect(p.authorities["a"].level).toBe("propose");
    expect(p.samples).toBe(2);
    expect(p.trainedAt).toBe(NOW);
  });
  it("n≥5 & wilson≥0.6 → apply-gated; n≥15 & wilson≥0.8 → trusted", () => {
    const good = trainPolicy(outcomes("a", Array(8).fill(true)), { now: NOW });
    expect(good.authorities["a"].level).toBe("apply-gated");
    const star = trainPolicy(outcomes("a", Array(20).fill(true)), { now: NOW });
    expect(star.authorities["a"].level).toBe("trusted");
    expect(wilsonLower(20, 20)).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.promoteTrustWilson);
  });
  it("demotion wins: n≥5 & wilson<0.3 → observe even with some successes", () => {
    const p = trainPolicy(outcomes("a", [true, false, false, false, false, false]), { now: NOW });
    expect(p.authorities["a"].level).toBe("observe");
    expect(p.authorities["a"].reason).toContain("demoted");
  });
  it("recurrence caps at propose regardless of a strong wilson", () => {
    const ledger = [
      ...outcomes("a", Array(18).fill(true)),
      ...outcomes("a", [false, false], "a:same-sig"),
    ];
    const p = trainPolicy(ledger, { now: NOW });
    expect(p.authorities["a"].level).toBe("propose");
    expect(p.authorities["a"].reason).toContain("capped");
  });
  it("recurrence outside the look-back window does not cap", () => {
    const ledger = [
      ...outcomes("a", [false, false], "a:old-sig"),        // old, will fall outside window
      ...outcomes("a", Array(40).fill(true)),               // pushes the failures out of last-20; wilson(40,42)≈0.84 ≥ 0.8
    ];
    const p = trainPolicy(ledger, { now: NOW });
    expect(p.authorities["a"].level).toBe("trusted");
  });
  it("thresholds are injectable", () => {
    const p = trainPolicy(outcomes("a", [true, true, true]), { now: NOW, thresholds: { promoteApplyN: 3, promoteApplyWilson: 0.2 } });
    expect(p.authorities["a"].level).toBe("apply-gated");
  });
});

describe("ucb1", () => {
  it("cold start: n=0 → Infinity (optimistic)", () => {
    expect(ucb1({ n: 0, ok: 0 }, 100)).toBe(Infinity);
  });
  it("monotone in mean at fixed n/totalN; exploration bonus shrinks with n", () => {
    expect(ucb1({ n: 10, ok: 9 }, 100)).toBeGreaterThan(ucb1({ n: 10, ok: 5 }, 100));
    expect(ucb1({ n: 2, ok: 1 }, 100) - 0.5).toBeGreaterThan(ucb1({ n: 50, ok: 25 }, 100) - 0.5);
  });
});

describe("selectActor", () => {
  const band = [actor("a"), actor("b"), actor("c")];
  it("explore: untried actor wins (Infinity), band-order tie-break is deterministic", () => {
    const p = emptyPolicy(NOW);
    p.bandit = { a: { n: 5, ok: 5 } }; // b and c untried → both Infinity → band order picks b
    expect(selectActor(band, p, "explore").id).toBe("b");
  });
  it("explore covers every actor before re-trying any (cold-start coverage)", () => {
    const p = emptyPolicy(NOW);
    const tried: string[] = [];
    for (let i = 0; i < band.length; i++) {
      const pick = selectActor(band, p, "explore");
      tried.push(pick.id);
      p.bandit[pick.id] = { n: 1, ok: 1 };
    }
    expect(new Set(tried).size).toBe(band.length);
  });
  it("exploit mirrors v2: wilson with n≥3, thin evidence neutral", () => {
    const p = emptyPolicy(NOW);
    p.bandit = { a: { n: 2, ok: 2 }, b: { n: 10, ok: 9 } };
    expect(selectActor(band, p, "exploit").id).toBe("b");
  });
});

describe("allowedAction (authority gate)", () => {
  it("unknown actor defaults to propose: may propose, may NOT apply", () => {
    const p = emptyPolicy(NOW);
    expect(allowedAction(p, "ghost", "propose")).toBe(true);
    expect(allowedAction(p, "ghost", "apply")).toBe(false);
  });
  it("observe-demoted actor may not even propose; trusted/apply-gated may apply", () => {
    const p = trainPolicy(outcomes("bad", [false, false, false, false, false]), { now: NOW });
    expect(allowedAction(p, "bad", "propose")).toBe(false);
    expect(allowedAction(p, "bad", "observe")).toBe(true);
    const g = trainPolicy(outcomes("good", Array(8).fill(true)), { now: NOW });
    expect(allowedAction(g, "good", "apply")).toBe(true);
  });
  it("rank order sanity", () => {
    expect(AUTHORITY_RANK.observe).toBeLessThan(AUTHORITY_RANK.propose);
    expect(AUTHORITY_RANK.propose).toBeLessThan(AUTHORITY_RANK["apply-gated"]);
    expect(AUTHORITY_RANK["apply-gated"]).toBeLessThan(AUTHORITY_RANK.trusted);
  });
});

describe("statsFromPolicy", () => {
  it("bridges bandit stats to ActorStat with wilson", () => {
    const p = trainPolicy(outcomes("a", [true, true, false, true]), { now: NOW });
    const m = statsFromPolicy(p);
    expect(m.get("a")).toMatchObject({ n: 4, ok: 3 });
    expect(m.get("a")!.wilson).toBeCloseTo(wilsonLower(3, 4), 10);
  });
});

describe("learningCurve", () => {
  it("improving rates → improved=true; regret is cumulative and non-decreasing", () => {
    const eps = [1, 2, 3, 4, 5, 6].map((r) => ({ round: r, ok: r, total: 6 }));
    const c = learningCurve(eps);
    expect(c.improved).toBe(true);
    expect(c.perRound[5]).toBe(1);
    for (let i = 1; i < c.regret.length; i++) expect(c.regret[i]).toBeGreaterThanOrEqual(c.regret[i - 1]);
  });
  it("declining rates → improved=false; empty → safe", () => {
    const eps = [6, 5, 4, 3, 2, 1].map((r, i) => ({ round: i + 1, ok: r, total: 6 }));
    expect(learningCurve(eps).improved).toBe(false);
    expect(learningCurve([])).toEqual({ perRound: [], improved: false, regret: [] });
  });
});
