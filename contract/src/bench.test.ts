import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, summarize, renderTable } from "./bench.ts";

test("percentile: nearest-rank; empty → 0", () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 90), 9);
  assert.equal(percentile(s, 99), 10);
  assert.equal(percentile(s, 100), 10);
  assert.equal(percentile([], 50), 0);
});

test("summarize: count/min/max/mean/p50/p90/p99; finite-only; empty → zeros", () => {
  const r = summarize([10, 20, 30, 40, 50]);
  assert.equal(r.count, 5);
  assert.equal(r.min, 10);
  assert.equal(r.max, 50);
  assert.equal(r.mean, 30);
  assert.equal(r.p50, 30);
  assert.ok(r.p90 >= 40);
  assert.ok(r.p99 >= 40);
  const bad = summarize([1, NaN, Infinity, 3]);
  assert.equal(bad.count, 2); // only finite kept
  assert.deepEqual(summarize([]), { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p99: 0 });
});

test("renderTable: markdown rows with the label + p50/p90/p99", () => {
  const t = renderTable([{ label: "mint", summary: summarize([1, 2, 3]) }]);
  assert.match(t, /mint/);
  assert.match(t, /p50/);
});
