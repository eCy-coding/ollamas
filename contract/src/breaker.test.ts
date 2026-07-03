import { test } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, backoffMs } from "./breaker.ts";

test("breaker: closed → open at threshold → half-open after cooldown → closed on success", () => {
  let t = 0;
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => t });
  assert.equal(b.state(), "closed");
  assert.equal(b.canTry(), true);
  b.onFailure(); b.onFailure();
  assert.equal(b.state(), "closed"); // 2 < 3
  b.onFailure(); // 3 → open
  assert.equal(b.state(), "open");
  assert.equal(b.canTry(), false);
  t = 1000; // cooldown elapsed
  assert.equal(b.state(), "half-open");
  assert.equal(b.canTry(), true);
  b.onSuccess();
  assert.equal(b.state(), "closed");
  assert.equal(b.canTry(), true);
});

test("breaker: failed half-open trial re-opens with fresh cooldown", () => {
  let t = 0;
  const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 500, now: () => t });
  b.onFailure(); // open
  assert.equal(b.state(), "open");
  t = 500; // half-open
  assert.equal(b.canTry(), true);
  b.onFailure(); // trial failed → re-open, fresh window
  t = 700;
  assert.equal(b.state(), "open"); // 700-500 = 200 < 500
  t = 1000;
  assert.equal(b.state(), "half-open");
});

test("backoffMs: exponential with clamp", () => {
  assert.equal(backoffMs(0, 1000, 60000), 1000);
  assert.equal(backoffMs(1, 1000, 60000), 2000);
  assert.equal(backoffMs(2, 1000, 60000), 4000);
  assert.equal(backoffMs(3, 1000, 60000), 8000);
  assert.equal(backoffMs(10, 1000, 60000), 60000); // clamped to max
  assert.equal(backoffMs(0, 5000, 300000), 5000);
});
