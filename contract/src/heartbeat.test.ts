import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFreshness, DEFAULT_STALE_MS, DEFAULT_DEAD_MS } from "./heartbeat.ts";

const NOW = Date.parse("2026-07-03T10:00:00.000Z");

test("fresh / stale / dead classification by age", () => {
  assert.equal(classifyFreshness("2026-07-03T09:59:30.000Z", NOW), "fresh");
  const staleAt = new Date(NOW - DEFAULT_STALE_MS - 1).toISOString();
  assert.equal(classifyFreshness(staleAt, NOW), "stale");
  const deadAt = new Date(NOW - DEFAULT_DEAD_MS - 1).toISOString();
  assert.equal(classifyFreshness(deadAt, NOW), "dead");
});

test("missing/garbage heartbeat is dead", () => {
  assert.equal(classifyFreshness(undefined, NOW), "dead");
  assert.equal(classifyFreshness("not-a-date", NOW), "dead");
});
