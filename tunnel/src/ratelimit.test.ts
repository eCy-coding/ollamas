// vT12: pure token-bucket rate limiter — deterministic via injected clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "./ratelimit.ts";

test("ratelimit: allows capacity burst then denies", () => {
  let now = 0;
  const allow = createLimiter({ capacity: 3, ratePerSec: 1 }, () => now);
  assert.equal(allow("k1"), true);
  assert.equal(allow("k1"), true);
  assert.equal(allow("k1"), true);
  assert.equal(allow("k1"), false);
});

test("ratelimit: refills at ratePerSec with injected clock", () => {
  let now = 0;
  const allow = createLimiter({ capacity: 2, ratePerSec: 1 }, () => now);
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), false);
  now = 1000; // 1s → exactly 1 token back
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), false);
});

test("ratelimit: refill never exceeds capacity", () => {
  let now = 0;
  const allow = createLimiter({ capacity: 2, ratePerSec: 10 }, () => now);
  assert.equal(allow("k"), true);
  now = 60_000; // huge idle — bucket caps at 2, not 600
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), false);
});

test("ratelimit: independent buckets per key", () => {
  let now = 0;
  const allow = createLimiter({ capacity: 1, ratePerSec: 1 }, () => now);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true); // b unaffected by a's exhaustion
});

test("ratelimit: unknown key starts with a fresh full bucket", () => {
  let now = 5_000;
  const allow = createLimiter({ capacity: 2, ratePerSec: 1 }, () => now);
  assert.equal(allow("fresh"), true);
  assert.equal(allow("fresh"), true);
  assert.equal(allow("fresh"), false);
});

test("ratelimit: fractional refill accumulates", () => {
  let now = 0;
  const allow = createLimiter({ capacity: 1, ratePerSec: 1 }, () => now);
  assert.equal(allow("k"), true);
  now = 500; // half a token — not enough
  assert.equal(allow("k"), false);
  now = 1000; // full token now
  assert.equal(allow("k"), true);
});

test("ratelimit: throws on capacity <= 0", () => {
  assert.throws(() => createLimiter({ capacity: 0, ratePerSec: 1 }), /capacity/);
  assert.throws(() => createLimiter({ capacity: -1, ratePerSec: 1 }), /capacity/);
});

test("ratelimit: throws on ratePerSec <= 0", () => {
  assert.throws(() => createLimiter({ capacity: 1, ratePerSec: 0 }), /ratePerSec/);
});

test("ratelimit: evicts oldest-seen key beyond maxKeys (unbounded-IP guard)", () => {
  let now = 0;
  const allow = createLimiter({ capacity: 1, ratePerSec: 1, maxKeys: 2 }, () => now);
  assert.equal(allow("a"), true); // a exhausted
  assert.equal(allow("b"), true);
  assert.equal(allow("c"), true); // evicts a (oldest)
  // a re-enters as fresh bucket → allowed again despite being exhausted before
  assert.equal(allow("a"), true);
});

test("ratelimit: default clock works (smoke, no injection)", () => {
  const allow = createLimiter({ capacity: 1, ratePerSec: 1 });
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), false);
});
