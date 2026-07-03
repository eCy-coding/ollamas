import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "./identity.ts";
import { mintInvite, verifyInvite, type InvitePayload } from "./invite.ts";

const HASH = "c".repeat(64);
const NOW = Date.parse("2026-07-03T10:00:00.000Z");

function payload(over: Partial<InvitePayload> = {}): InvitePayload {
  return {
    v: 1,
    jti: "abc123",
    iat: "2026-07-03T10:00:00.000Z",
    expiresAt: "2026-07-03T10:15:00.000Z",
    quotaReqPerDay: 1000,
    contractHash: HASH,
    serverUrl: "http://100.64.0.1:3000",
    epoch: 1,
    ...over,
  };
}

test("mint → verify roundtrip (valid)", () => {
  const id = generateIdentity();
  const token = mintInvite(payload(), id.privateKeyPem);
  const r = verifyInvite(token, id.publicKeyHex, NOW, HASH, 1);
  assert.equal(r.valid, true);
  assert.equal(r.payload?.jti, "abc123");
  assert.equal(r.payload?.serverUrl, "http://100.64.0.1:3000");
});

test("vK19: one-click fields (headscaleUrl/authkey/opPubHex) survive signed roundtrip", () => {
  const id = generateIdentity();
  const token = mintInvite(payload({ headscaleUrl: "http://mac.local:8080", authkey: "tskey-abc", opPubHex: id.publicKeyHex }), id.privateKeyPem);
  const r = verifyInvite(token, id.publicKeyHex, NOW, HASH, 1);
  assert.equal(r.valid, true);
  assert.equal(r.payload?.headscaleUrl, "http://mac.local:8080");
  assert.equal(r.payload?.authkey, "tskey-abc");
  assert.equal(r.payload?.opPubHex, id.publicKeyHex);
  // tampering the authkey after signing → invalid (body-covered signature)
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify(payload({ authkey: "tskey-STOLEN", opPubHex: id.publicKeyHex })), "utf8").toString("base64url");
  assert.equal(verifyInvite(`${forged}.${sig}`, id.publicKeyHex, NOW, HASH, 1).valid, false);
  assert.ok(body);
});

test("forged signature (wrong key) → invalid", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const token = mintInvite(payload(), a.privateKeyPem);
  const r = verifyInvite(token, b.publicKeyHex, NOW, HASH, 1);
  assert.equal(r.valid, false);
  assert.match(r.reason || "", /signature/i);
});

test("tampered payload → invalid (sig covers the encoded body)", () => {
  const id = generateIdentity();
  const token = mintInvite(payload(), id.privateKeyPem);
  const [body, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify(payload({ quotaReqPerDay: 999999 }))).toString("base64url");
  assert.equal(verifyInvite(`${forgedBody}.${sig}`, id.publicKeyHex, NOW, HASH, 1).valid, false);
  assert.ok(body && sig);
});

test("expired → invalid", () => {
  const id = generateIdentity();
  const token = mintInvite(payload(), id.privateKeyPem);
  const later = Date.parse("2026-07-03T10:20:00.000Z"); // past expiresAt
  const r = verifyInvite(token, id.publicKeyHex, later, HASH, 1);
  assert.equal(r.valid, false);
  assert.match(r.reason || "", /expired/i);
});

test("contract-hash mismatch → invalid (re-accept)", () => {
  const id = generateIdentity();
  const token = mintInvite(payload(), id.privateKeyPem);
  const r = verifyInvite(token, id.publicKeyHex, NOW, "d".repeat(64), 1);
  assert.equal(r.valid, false);
  assert.match(r.reason || "", /contract/i);
});

test("stale epoch → invalid (operator key rotated = kill switch)", () => {
  const id = generateIdentity();
  const token = mintInvite(payload({ epoch: 1 }), id.privateKeyPem);
  const r = verifyInvite(token, id.publicKeyHex, NOW, HASH, 2); // server epoch advanced
  assert.equal(r.valid, false);
  assert.match(r.reason || "", /epoch/i);
});

test("malformed token → invalid, never throws", () => {
  const id = generateIdentity();
  assert.equal(verifyInvite("garbage", id.publicKeyHex, NOW, HASH, 1).valid, false);
  assert.equal(verifyInvite("a.b.c", id.publicKeyHex, NOW, HASH, 1).valid, false);
  assert.equal(verifyInvite("", id.publicKeyHex, NOW, HASH, 1).valid, false);
});
