import { describe, it, expect } from "vitest";
import { parseOrgChart, type LedgerEntry, type ErrorEntryProposal, type PreventionRule } from "../bin/lib/organization";
import { runRound, proposalsAsRules, failedActorsFor, bootstrapHistory, waveFor, SANDBOX_CHART_JSON } from "../bin/lib/sandbox-round";

const TS = "2026-07-18T02:00:00Z";
const chart = () => parseOrgChart(JSON.parse(JSON.stringify(SANDBOX_CHART_JSON)));

/** Drive N rounds purely (the same accumulation the IO shell does). */
function drive(rounds: number, downFor: (r: number) => string[] = (r) => (r % 2 === 0 ? ["vision"] : [])) {
  let ledger: LedgerEntry[] = bootstrapHistory(TS);
  const proposals: ErrorEntryProposal[] = [];
  const violations: string[] = [];
  let seq = 1;
  const rules: PreventionRule[] = []; // no real registries in unit tests — sandbox proposals only
  const perRound: ReturnType<typeof runRound>[] = [];
  for (let round = 1; round <= rounds; round++) {
    const r = runRound({ chart: chart(), rules: [...rules, ...proposalsAsRules(proposals)], ledger, round, downActors: downFor(round), nextErrorSeq: seq, ts: TS });
    ledger = [...ledger, ...r.newLedger];
    proposals.push(...r.newProposals);
    violations.push(...r.violations);
    seq = r.nextErrorSeq;
    perRound.push(r);
  }
  return { ledger, proposals, violations, perRound };
}

describe("runRound (pure sandbox core)", () => {
  it("5 rounds run with zero invariant violations (sustainability core)", () => {
    expect(drive(5).violations).toEqual([]);
  });

  it("round 1: flaky+stubborn fail → 2 proposals; wave writes dispatch+outcome per task", () => {
    const { perRound } = drive(1);
    const r1 = perRound[0];
    expect(r1.newProposals).toHaveLength(2);
    expect(r1.newLedger).toHaveLength(waveFor(1).length * 2);
    expect(r1.dispatches.filter((d) => !d.ok).map((d) => d.taskId).sort()).toEqual(["sb-flaky", "sb-stubborn"]);
  });

  it("route-away converges: flaky walks conductor → odysseus → joker, then stays green", () => {
    const { perRound } = drive(4);
    const flakyActors = perRound.map((r) => r.dispatches.find((d) => d.taskId === "sb-flaky")!.actorId);
    expect(flakyActors.slice(0, 3)).toEqual(["conductor", "odysseus", "joker"]);
    expect(flakyActors[3]).toBe("joker"); // converged
    expect(perRound[2].dispatches.find((d) => d.taskId === "sb-flaky")!.ok).toBe(true);
  });

  it("round 2+ flaky brief carries round 1's proposal rule (never repeat, verbatim)", () => {
    const { perRound } = drive(2);
    const r2flaky = perRound[1].dispatches.find((d) => d.taskId === "sb-flaky")!;
    expect(r2flaky.rulesInBrief.some((id) => id.startsWith("ERR-ORG-"))).toBe(true);
  });

  it("recurrence: stubborn round-2 override re-fails same sig → hardened proposal; round 3 escalates", () => {
    const { perRound, proposals } = drive(3);
    const hardened = proposals.find((p) => p.recurrence_count >= 1);
    expect(hardened).toBeDefined();
    expect(hardened!.prevention_rule).toContain("RECURRENCE");
    const r3 = perRound[2].dispatches.find((d) => d.taskId === "sb-stubborn")!;
    expect(r3.actorId).not.toBe("transcriber");
    expect(r3.ok).toBe(true);
  });

  it("evidence-weighted routing: bootstrap history sends code tasks to coder-b from round 1", () => {
    const { perRound } = drive(1);
    const code = perRound[0].dispatches.find((d) => d.taskId === "sb-code-r1")!;
    expect(code.actorId).toBe("coder-b");
    expect(code.reason).toBe("evidence-weighted");
  });

  it("actor-down chaos: vision tasks never land on the down actor", () => {
    const { perRound, violations } = drive(2);
    expect(perRound[1].dispatches.find((d) => d.taskId === "sb-vision-r2")!.actorId).toBe("librarian");
    expect(violations).toEqual([]);
  });

  it("failedActorsFor + proposalsAsRules helpers", () => {
    const { ledger, proposals } = drive(1);
    expect(failedActorsFor(ledger, "sb-flaky")).toEqual(["conductor"]);
    const rules = proposalsAsRules(proposals);
    expect(rules.every((r) => r.source === "sandbox:ERRORS_PROPOSED" && r.rule.length > 0)).toBe(true);
  });

  it("ERR-ORG ids stay unique across rounds", () => {
    const { proposals } = drive(5);
    const ids = proposals.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
