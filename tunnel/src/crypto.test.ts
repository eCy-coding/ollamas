import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { open, seal } from "./crypto.ts";

const key = Buffer.alloc(32, 7); // deterministic 32-byte key
const iv = Buffer.alloc(12, 3); // deterministic iv

test("round-trips plaintext", () => {
  const sealed = seal("hunter2-secret", key);
  assert.equal(open(sealed, key), "hunter2-secret");
});

test("deterministic iv → reproducible ciphertext", () => {
  const a = seal("same", key, { iv });
  const b = seal("same", key, { iv });
  assert.equal(a.ct, b.ct);
  assert.equal(a.tag, b.tag);
});

test("envelope fields are base64 + 12-byte iv / 16-byte tag", () => {
  const s = seal("x", key, { iv });
  assert.equal(Buffer.from(s.iv, "base64").length, 12);
  assert.equal(Buffer.from(s.tag, "base64").length, 16);
});

test("wrong key → throws (no silent garbage)", () => {
  const sealed = seal("secret", key);
  assert.throws(() => open(sealed, Buffer.alloc(32, 9)));
});

test("tampered ciphertext → throws", () => {
  const sealed = seal("secret", key, { iv });
  const bad = { ...sealed, ct: Buffer.from("zzzz").toString("base64") };
  assert.throws(() => open(bad, key));
});

test("tampered tag → throws", () => {
  const sealed = seal("secret", key, { iv });
  const bad = { ...sealed, tag: Buffer.alloc(16, 0).toString("base64") };
  assert.throws(() => open(bad, key));
});

test("rejects non-32-byte key", () => {
  assert.throws(() => seal("x", Buffer.alloc(16)));
});
