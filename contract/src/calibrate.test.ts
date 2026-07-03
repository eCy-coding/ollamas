import { test } from "node:test";
import assert from "node:assert/strict";
import { microbench, runPureCalibration, assertInvariants } from "./calibrate.ts";

test("microbench returns one sample per iteration (non-negative ms)", () => {
  let n = 0;
  const s = microbench(() => { n++; }, 50);
  assert.equal(s.length, 50);
  assert.equal(n, 50);
  assert.ok(s.every((x) => x >= 0 && Number.isFinite(x)));
});

test("runPureCalibration measures all pure paths → labeled summaries", () => {
  const r = runPureCalibration({ iters: 30 });
  const labels = r.rows.map((x) => x.label);
  for (const need of ["invite.mint", "invite.verify", "registry.apply", "backoff"]) {
    assert.ok(labels.includes(need), `missing ${need}`);
  }
  assert.ok(r.rows.every((x) => x.summary.count === 30));
});

test("assertInvariants: all 10 security/efficiency invariants PASS on a clean build", () => {
  const r = assertInvariants();
  assert.equal(r.failed.length, 0, `failures: ${JSON.stringify(r.failed)}`);
  assert.ok(r.passed >= 10);
});
