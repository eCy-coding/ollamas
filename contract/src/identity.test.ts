import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity, signPayload, verifyPayload } from "./identity.ts";

test("generate → sign → verify roundtrip", () => {
  const id = generateIdentity();
  assert.match(id.publicKeyHex, /^[0-9a-f]+$/);
  const sig = signPayload(id.privateKeyPem, "join-request:m_1");
  assert.equal(verifyPayload(id.publicKeyHex, "join-request:m_1", sig), true);
});

test("tampered payload fails verification", () => {
  const id = generateIdentity();
  const sig = signPayload(id.privateKeyPem, "payload");
  assert.equal(verifyPayload(id.publicKeyHex, "payload-tampered", sig), false);
});

test("wrong key fails verification", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const sig = signPayload(a.privateKeyPem, "payload");
  assert.equal(verifyPayload(b.publicKeyHex, "payload", sig), false);
});

test("malformed pubkey returns false, not throw", () => {
  const a = generateIdentity();
  const sig = signPayload(a.privateKeyPem, "payload");
  assert.equal(verifyPayload("zz-not-hex", "payload", sig), false);
});
