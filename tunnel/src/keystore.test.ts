import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateKeyfile, openFromFile, sealToFile } from "./keystore.ts";

function tmp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-keystore-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("loadOrCreateKeyfile creates a 32-byte 0600 keyfile, idempotent", () => {
  const { dir, cleanup } = tmp();
  try {
    const p = join(dir, "master.key");
    const k1 = loadOrCreateKeyfile(p);
    assert.equal(k1.length, 32);
    assert.equal(existsSync(p), true);
    assert.equal(statSync(p).mode & 0o777, 0o600);
    const k2 = loadOrCreateKeyfile(p); // second call returns the SAME key
    assert.equal(Buffer.compare(k1, k2), 0);
  } finally {
    cleanup();
  }
});

test("seal/open vault round-trips an object", () => {
  const { dir, cleanup } = tmp();
  try {
    const key = loadOrCreateKeyfile(join(dir, "master.key"));
    const vault = join(dir, "vault.enc");
    sealToFile(vault, { preauth: "tskey-abc", note: "mesh" }, key);
    const got = openFromFile<{ preauth: string; note: string }>(vault, key);
    assert.equal(got?.preauth, "tskey-abc");
    assert.equal(got?.note, "mesh");
  } finally {
    cleanup();
  }
});

test("openFromFile graceful-degrades on missing file", () => {
  const { dir, cleanup } = tmp();
  try {
    const key = loadOrCreateKeyfile(join(dir, "master.key"));
    assert.equal(openFromFile(join(dir, "nope.enc"), key), null);
  } finally {
    cleanup();
  }
});

test("openFromFile graceful-degrades on corrupt vault (no throw)", () => {
  const { dir, cleanup } = tmp();
  try {
    const key = loadOrCreateKeyfile(join(dir, "master.key"));
    const vault = join(dir, "vault.enc");
    writeFileSync(vault, "not-json-at-all");
    assert.equal(openFromFile(vault, key), null);
  } finally {
    cleanup();
  }
});

test("wrong key → openFromFile returns null (degrade, not crash)", () => {
  const { dir, cleanup } = tmp();
  try {
    const key = loadOrCreateKeyfile(join(dir, "master.key"));
    const vault = join(dir, "vault.enc");
    sealToFile(vault, { x: 1 }, key);
    const wrong = Buffer.alloc(32, 1);
    assert.equal(openFromFile(vault, wrong), null);
  } finally {
    cleanup();
  }
});
