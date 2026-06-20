import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateIfNeeded } from "./logrotate.ts";

function tmp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-logrotate-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("missing file → no-op", () => {
  const { dir, cleanup } = tmp();
  try {
    const r = rotateIfNeeded(join(dir, "nope.log"), { maxBytes: 10 });
    assert.equal(r.rotated, false);
  } finally {
    cleanup();
  }
});

test("under cap → no-op", () => {
  const { dir, cleanup } = tmp();
  try {
    const p = join(dir, "x.log");
    writeFileSync(p, "small");
    assert.equal(rotateIfNeeded(p, { maxBytes: 1000 }).rotated, false);
    assert.equal(existsSync(p), true);
  } finally {
    cleanup();
  }
});

test("over cap → rotates current to .1 and clears current", () => {
  const { dir, cleanup } = tmp();
  try {
    const p = join(dir, "x.log");
    writeFileSync(p, "X".repeat(100));
    const r = rotateIfNeeded(p, { maxBytes: 10, keep: 3 });
    assert.equal(r.rotated, true);
    assert.equal(existsSync(`${p}.1`), true);
    assert.equal(existsSync(p), false); // caller's next append recreates it
  } finally {
    cleanup();
  }
});

test("keep-N ring: oldest dropped, others shift", () => {
  const { dir, cleanup } = tmp();
  try {
    const p = join(dir, "x.log");
    // seed an existing ring
    writeFileSync(`${p}.1`, "one");
    writeFileSync(`${p}.2`, "two");
    writeFileSync(`${p}.3`, "three"); // this is the oldest with keep=3 → will be dropped
    writeFileSync(p, "Y".repeat(100));
    rotateIfNeeded(p, { maxBytes: 10, keep: 3 });
    // after rotate: current→.1, .1→.2, .2→.3, old .3 dropped
    assert.equal(readFileSync(`${p}.1`, "utf8"), "Y".repeat(100));
    assert.equal(readFileSync(`${p}.2`, "utf8"), "one");
    assert.equal(readFileSync(`${p}.3`, "utf8"), "two");
    assert.equal(existsSync(`${p}.4`), false); // keep=3, no .4
  } finally {
    cleanup();
  }
});

test("idempotent-ish: second call under cap (current gone) → no-op", () => {
  const { dir, cleanup } = tmp();
  try {
    const p = join(dir, "x.log");
    writeFileSync(p, "Z".repeat(100));
    rotateIfNeeded(p, { maxBytes: 10, keep: 2 });
    const r2 = rotateIfNeeded(p, { maxBytes: 10, keep: 2 }); // current no longer exists
    assert.equal(r2.rotated, false);
  } finally {
    cleanup();
  }
});
