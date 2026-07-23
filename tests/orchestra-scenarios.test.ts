// L46 — the scenario matrix is the spec for "it works on real tasks".
//
// The outcome ledger held only two distinct tasks, both test tasks. A task fails in more ways
// than it succeeds, so each scenario states a structural expectation an observer can check.
// These tests assert the spec is internally honest: every stated `expect` matches what the real
// planner derives, and the families it claims to cover are actually present.
import { describe, test, expect } from "vitest";
import { SCENARIOS, deriveExpect, isGatedTitle } from "../server/orchestra-scenarios";

describe("the scenario spec is honest", () => {
  test("every scenario's stated expectation matches what the real planner derives", () => {
    // This is the whole point: the spec cannot drift from runtime behaviour, because the
    // expectation is checked against the same planTask/ecymPropose the server uses.
    for (const sc of SCENARIOS) {
      const d = deriveExpect(sc.title);
      expect(d.hasCommand, `${sc.title} · hasCommand`).toBe(sc.expect.hasCommand);
      expect(d.gated, `${sc.title} · gated`).toBe(sc.expect.gated);
    }
  });

  test("a gated scenario's command is genuinely one the safety table would gate", () => {
    for (const sc of SCENARIOS.filter((s) => s.expect.gated)) {
      expect(isGatedTitle(sc.title), sc.title).toBe(true);
    }
  });

  test("a no-command scenario really has no catalog match", () => {
    for (const sc of SCENARIOS.filter((s) => !s.expect.hasCommand)) {
      expect(deriveExpect(sc.title).hasCommand, sc.title).toBe(false);
    }
  });

  test("the matrix covers the failure shapes, not just the happy path", () => {
    const kinds = new Set(SCENARIOS.map((s) => s.expect.kind));
    // Each of these is a distinct way a task behaves; a suite missing any of them proves less.
    for (const k of ["single", "multi-part", "no-command", "gated"] as const) {
      expect(kinds.has(k), `missing scenario family: ${k}`).toBe(true);
    }
  });

  test("every scenario is documented and distinct", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(8);
    const titles = SCENARIOS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const s of SCENARIOS) expect(s.why.length, s.title).toBeGreaterThan(10);
  });
});
