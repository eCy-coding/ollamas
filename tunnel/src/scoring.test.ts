import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_HYSTERESIS,
  chooseWithHysteresis,
  rank,
  scoreCandidate,
  type Candidate,
} from "./scoring.ts";

const C = (over: Partial<Candidate>): Candidate => ({
  name: "x",
  priority: 20,
  latencyMs: 50,
  breakerOpen: false,
  healthy: true,
  ...over,
});

test("unhealthy / breaker-open / non-finite latency → Infinity score", () => {
  assert.equal(scoreCandidate(C({ healthy: false })), Infinity);
  assert.equal(scoreCandidate(C({ breakerOpen: true })), Infinity);
  assert.equal(scoreCandidate(C({ latencyMs: Infinity })), Infinity);
});

test("lower latency wins within the same band", () => {
  const r = rank([
    C({ name: "slow", priority: 20, latencyMs: 200 }),
    C({ name: "fast", priority: 20, latencyMs: 20 }),
  ]);
  assert.equal(r[0]?.name, "fast");
});

test("priority decides when latency is equal", () => {
  const r = rank([
    C({ name: "mesh", priority: 20, latencyMs: 30 }),
    C({ name: "lan", priority: 10, latencyMs: 30 }),
  ]);
  assert.equal(r[0]?.name, "lan");
});

test("big latency gap beats a better priority band", () => {
  // lan(pri10) but 500ms vs mesh(pri20) 20ms → mesh wins (latency dominates within weights)
  const r = rank([
    C({ name: "lan", priority: 10, latencyMs: 500 }),
    C({ name: "mesh", priority: 20, latencyMs: 20 }),
  ]);
  assert.equal(r[0]?.name, "mesh");
});

test("no eligible transport → winner null", () => {
  const res = chooseWithHysteresis(null, [C({ healthy: false })]);
  assert.equal(res.winner, null);
});

test("initial pick when no active", () => {
  const res = chooseWithHysteresis(null, [C({ name: "lan", priority: 10, latencyMs: 10 })]);
  assert.equal(res.winner, "lan");
  assert.equal(res.switched, false);
});

test("immediate failover when active becomes ineligible", () => {
  const res = chooseWithHysteresis(
    "lan",
    [C({ name: "lan", healthy: false }), C({ name: "mesh", priority: 20, latencyMs: 40 })],
  );
  assert.equal(res.winner, "mesh");
  assert.equal(res.switched, true);
  assert.match(res.reason, /failover/);
});

test("hysteresis holds active when challenger lead < margin", () => {
  const res = chooseWithHysteresis(
    "lan",
    [C({ name: "lan", priority: 10, latencyMs: 100 }), C({ name: "mesh", priority: 20, latencyMs: 95 })],
    EMPTY_HYSTERESIS,
    { margin: 50, holdRounds: 2 },
  );
  // lan score=100+100=200, mesh=95+200=295 → lan actually best; sanity: active kept
  assert.equal(res.winner, "lan");
  assert.equal(res.switched, false);
});

test("takeover only after challenger leads by margin for holdRounds", () => {
  // Make mesh genuinely better: lan slow+high latency, mesh fast.
  const cands = [
    C({ name: "lan", priority: 10, latencyMs: 400 }), // score 400+100=500
    C({ name: "mesh", priority: 20, latencyMs: 20 }), // score 20+200=220 → lead 280 >= margin
  ];
  const r1 = chooseWithHysteresis("lan", cands, EMPTY_HYSTERESIS, { margin: 50, holdRounds: 2 });
  assert.equal(r1.winner, "lan"); // round 1: streak 1, hold
  assert.equal(r1.state.streak, 1);
  const r2 = chooseWithHysteresis("lan", cands, r1.state, { margin: 50, holdRounds: 2 });
  assert.equal(r2.winner, "mesh"); // round 2: streak 2 → takeover
  assert.equal(r2.switched, true);
});

test("challenger streak resets if a different challenger appears", () => {
  const round1 = chooseWithHysteresis(
    "lan",
    [C({ name: "lan", priority: 10, latencyMs: 400 }), C({ name: "mesh", priority: 20, latencyMs: 20 })],
    EMPTY_HYSTERESIS,
    { margin: 50, holdRounds: 3 },
  );
  assert.equal(round1.state.challenger, "mesh");
  assert.equal(round1.state.streak, 1);
  const round2 = chooseWithHysteresis(
    "lan",
    [C({ name: "lan", priority: 10, latencyMs: 400 }), C({ name: "wg", priority: 20, latencyMs: 20 })],
    round1.state,
    { margin: 50, holdRounds: 3 },
  );
  assert.equal(round2.state.challenger, "wg");
  assert.equal(round2.state.streak, 1); // reset, not 2
});
