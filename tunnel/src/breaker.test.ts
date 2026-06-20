import test from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "./breaker.ts";

// Controllable fake clock for deterministic state transitions.
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("starts closed and allows attempts", () => {
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
  assert.equal(b.state(), "closed");
  assert.equal(b.canTry(), true);
});

test("trips open after threshold consecutive failures", () => {
  const c = clock();
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: c.now });
  b.onFailure();
  b.onFailure();
  assert.equal(b.state(), "closed"); // 2 < 3
  b.onFailure();
  assert.equal(b.state(), "open"); // 3 >= 3
  assert.equal(b.canTry(), false);
});

test("success before threshold resets the count", () => {
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  b.onSuccess();
  b.onFailure();
  b.onFailure();
  assert.equal(b.state(), "closed"); // reset → only 2 since success
});

test("open → half-open after cooldown elapses", () => {
  const c = clock();
  const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: c.now });
  b.onFailure();
  b.onFailure();
  assert.equal(b.state(), "open");
  c.advance(999);
  assert.equal(b.state(), "open"); // not yet
  c.advance(1);
  assert.equal(b.state(), "half-open"); // cooldown reached
  assert.equal(b.canTry(), true); // one trial allowed
});

test("half-open trial success → closed", () => {
  const c = clock();
  const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: c.now });
  b.onFailure();
  b.onFailure();
  c.advance(1000);
  assert.equal(b.canTry(), true); // half-open trial
  b.onSuccess();
  assert.equal(b.state(), "closed");
  assert.equal(b.canTry(), true);
});

test("half-open trial failure → re-open with fresh cooldown", () => {
  const c = clock();
  const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: c.now });
  b.onFailure();
  b.onFailure();
  c.advance(1000);
  assert.equal(b.canTry(), true); // half-open
  b.onFailure(); // trial fails
  assert.equal(b.state(), "open"); // re-tripped
  c.advance(999);
  assert.equal(b.state(), "open"); // fresh window
  c.advance(1);
  assert.equal(b.state(), "half-open");
});
