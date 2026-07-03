import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "./identity.ts";
import { bundleSha256, signBundle, verifyBundle } from "./bundle.ts";

test("sha256 is deterministic hex", () => {
  const h = bundleSha256(Buffer.from("hello"));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, bundleSha256(Buffer.from("hello")));
  assert.notEqual(h, bundleSha256(Buffer.from("hellp")));
});

test("sign → verify roundtrip; tamper → false; wrong key → false; never throws", () => {
  const op = generateIdentity();
  const bytes = Buffer.from("#!/usr/bin/env node\nconsole.log('cli')\n");
  const sig = signBundle(bundleSha256(bytes), op.privateKeyPem);
  assert.equal(verifyBundle(bytes, sig, op.publicKeyHex), true);
  // tampered bytes → false
  assert.equal(verifyBundle(Buffer.from("#!/usr/bin/env node\nEVIL\n"), sig, op.publicKeyHex), false);
  // wrong operator key → false
  const other = generateIdentity();
  assert.equal(verifyBundle(bytes, sig, other.publicKeyHex), false);
  // garbage sig / pubkey → false, no throw
  assert.equal(verifyBundle(bytes, "zzz", op.publicKeyHex), false);
  assert.equal(verifyBundle(bytes, sig, "not-hex"), false);
});
