import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDoctor, type DoctorStep } from "./doctor.ts";

// runDoctor drives a REAL server end-to-end (ERR-TUNNEL-003: unit tests cannot prove the live
// path) so it is exercised by the live doctor run, not here. renderDoctor is the pure formatter
// on top of its result — deterministic, socket-free — so we pin its contract directly.

test("renderDoctor: one aligned line per step + trailing OK verdict when all pass", () => {
  const steps: DoctorStep[] = [
    { name: "health", ok: true, detail: "GET /api/health → 200" },
    { name: "document", ok: true, detail: "hash=deadbeef…" },
  ];
  const out = renderDoctor({ ok: true, steps });
  const lines = out.split("\n");
  const at = (i: number): string => lines[i] ?? "";
  assert.equal(lines.length, steps.length + 1); // steps + verdict
  assert.ok(at(0).startsWith("✓ "));
  assert.ok(at(0).includes("health"));
  assert.ok(at(1).includes("document"));
  assert.equal(at(lines.length - 1), "DOCTOR: OK");
});

test("renderDoctor: marks a failed step with ✗ and emits a FAIL verdict", () => {
  const steps: DoctorStep[] = [
    { name: "health", ok: true, detail: "GET /api/health → 200" },
    { name: "apply", ok: false, detail: "id=undefined" },
  ];
  const out = renderDoctor({ ok: false, steps });
  const lines = out.split("\n");
  assert.ok((lines[1] ?? "").startsWith("✗ "), "failing step prefixed with ✗");
  assert.equal(lines[lines.length - 1] ?? "", "DOCTOR: FAIL");
});

test("renderDoctor: pads step names to a stable column width for alignment", () => {
  const out = renderDoctor({ ok: true, steps: [{ name: "ok", ok: true, detail: "x" }] });
  // name padEnd(20) then a space → detail begins at a fixed offset regardless of name length.
  const first = out.split("\n")[0] ?? "";
  assert.ok(first.indexOf(" x") >= 2 + 20, "detail column is padded past the 20-char name field");
});

test("renderDoctor: empty step list still yields a single verdict line", () => {
  assert.equal(renderDoctor({ ok: true, steps: [] }), "DOCTOR: OK");
  assert.equal(renderDoctor({ ok: false, steps: [] }), "DOCTOR: FAIL");
});
