import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateOperatorKey, rotateOperatorKey } from "./opkey.ts";

function tmpKey(): string {
  return join(mkdtempSync(join(tmpdir(), "opkey-")), "sub", "operator-key.json");
}

test("create on first use (epoch 1, 0600); load returns the same", () => {
  const p = tmpKey();
  const a = loadOrCreateOperatorKey(p);
  assert.equal(a.epoch, 1);
  assert.match(a.publicKeyHex, /^[0-9a-f]+$/);
  assert.ok(a.privateKeyPem.includes("PRIVATE KEY"));
  assert.equal(statSync(p).mode & 0o777, 0o600);
  const b = loadOrCreateOperatorKey(p);
  assert.equal(b.publicKeyHex, a.publicKeyHex); // stable
  assert.equal(b.epoch, 1);
});

test("rotate → new key + bumped epoch (kill switch)", () => {
  const p = tmpKey();
  const a = loadOrCreateOperatorKey(p);
  const r = rotateOperatorKey(p);
  assert.equal(r.epoch, 2);
  assert.notEqual(r.publicKeyHex, a.publicKeyHex);
  // subsequent load reflects the rotation
  const c = loadOrCreateOperatorKey(p);
  assert.equal(c.epoch, 2);
  assert.equal(c.publicKeyHex, r.publicKeyHex);
});
