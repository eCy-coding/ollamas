import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_AGE_DAYS, daysUntilRotation, needsRotation, rotationPlan } from "./rotate.ts";
import { DEFAULT_PLAN, type WgPlan } from "./transports/wireguard.ts";

const DAY = 24 * 60 * 60 * 1000;
const plan: WgPlan = { ...DEFAULT_PLAN, endpointHost: "192.168.1.42" };

test("needsRotation false before max age, true at/after", () => {
  const meta = { createdAt: 0, version: 1 };
  assert.equal(needsRotation(meta, 89 * DAY), false);
  assert.equal(needsRotation(meta, 90 * DAY), true);
  assert.equal(needsRotation(meta, 200 * DAY), true);
});

test("custom max age honored", () => {
  const meta = { createdAt: 0, version: 1 };
  assert.equal(needsRotation(meta, 31 * DAY, 30), true);
  assert.equal(needsRotation(meta, 29 * DAY, 30), false);
});

test("daysUntilRotation counts down then floors at 0", () => {
  const meta = { createdAt: 0, version: 1 };
  assert.equal(daysUntilRotation(meta, 0), DEFAULT_MAX_AGE_DAYS);
  assert.equal(daysUntilRotation(meta, 80 * DAY), 10);
  assert.equal(daysUntilRotation(meta, 100 * DAY), 0);
});

test("rotationPlan renders fresh configs with new keys + bumps version", () => {
  const out = rotationPlan(
    plan,
    { privateKey: "SRV_NEW_PRIV", publicKey: "SRV_NEW_PUB" },
    { privateKey: "PHONE_NEW_PRIV", publicKey: "PHONE_NEW_PUB" },
    { createdAt: 0, version: 3 },
    123_456,
  );
  assert.match(out.serverConf, /PrivateKey = SRV_NEW_PRIV/);
  assert.match(out.serverConf, /PublicKey = PHONE_NEW_PUB/);
  assert.match(out.peerConf, /PrivateKey = PHONE_NEW_PRIV/);
  assert.match(out.peerConf, /PublicKey = SRV_NEW_PUB/);
  assert.equal(out.meta.version, 4);
  assert.equal(out.meta.createdAt, 123_456);
});

test("rotationPlan preserves /32 split-tunnel invariant (no AllowedIPs overlap)", () => {
  const out = rotationPlan(
    plan,
    { privateKey: "a", publicKey: "b" },
    { privateKey: "c", publicKey: "d" },
    { createdAt: 0, version: 1 },
    1,
  );
  // peer routes ONLY the server /32 (split tunnel), server routes ONLY the peer /32
  assert.match(out.peerConf, /AllowedIPs = 10\.7\.0\.1\/32/);
  assert.match(out.serverConf, /AllowedIPs = 10\.7\.0\.2\/32/);
});
