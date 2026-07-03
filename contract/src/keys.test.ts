import { test } from "node:test";
import assert from "node:assert/strict";
import { approveWithKey, revokeWithKey, rotateWithKey, type KeyBridge } from "./keys.ts";
import { applyForMembership, approveMember, emptyState, getMember } from "./registry.ts";

const HASH = "c".repeat(64);
const NOW = "2026-07-03T10:00:00.000Z";

function fakeBridge(log: string[]): KeyBridge {
  return {
    createTenant: async (name) => {
      log.push(`tenant:${name}`);
      return { id: "tnt_x" };
    },
    issueKey: async (tenantId, label) => {
      log.push(`issue:${tenantId}:${label}`);
      return { id: "key_x", key: "olm_RAW_SECRET" };
    },
    revokeKey: async (keyId) => {
      log.push(`revoke:${keyId}`);
    },
  };
}

function pendingState() {
  return applyForMembership(
    emptyState(),
    { email: "a@example.com", machinePubkey: "aa".repeat(32), specs: { ramGB: 16, os: "darwin", arch: "arm64" }, contractHash: HASH },
    HASH,
    NOW,
  );
}

test("approveWithKey: tenant → key → active; raw key only in return value, never in state", async () => {
  const { state, member } = pendingState();
  const log: string[] = [];
  const r = await approveWithKey(state, member.id, fakeBridge(log), NOW);
  assert.equal(r.rawKey, "olm_RAW_SECRET");
  assert.deepEqual(log, ["tenant:contract:a@example.com", `issue:tnt_x:contract:${member.id}`]);
  const m = getMember(r.state, member.id);
  assert.equal(m?.status, "active");
  assert.equal(m?.keyId, "key_x");
  assert.equal(m?.tenantId, "tnt_x");
  assert.ok(!JSON.stringify(r.state).includes("olm_"), "raw key leaked into state (ERR-CONTRACT-002)");
});

test("approveWithKey on non-pending throws before any bridge call", async () => {
  const { state, member } = pendingState();
  const log: string[] = [];
  const bridge = fakeBridge(log);
  const r = await approveWithKey(state, member.id, bridge, NOW);
  await assert.rejects(() => approveWithKey(r.state, member.id, bridge, NOW), /transition/i);
  assert.equal(log.filter((l) => l.startsWith("tenant:")).length, 1);
});

test("revokeWithKey revokes registry AND store key", async () => {
  const { state, member } = pendingState();
  const log: string[] = [];
  const bridge = fakeBridge(log);
  const r = await approveWithKey(state, member.id, bridge, NOW);
  const next = await revokeWithKey(r.state, member.id, bridge);
  assert.equal(getMember(next, member.id)?.status, "revoked");
  assert.ok(log.includes("revoke:key_x"));
});

test("rotateWithKey: new key issued on same tenant, keyId swapped, OLD key revoked; raw only in return (vK13)", async () => {
  const { state, member } = pendingState();
  const log: string[] = [];
  const bridge = fakeBridge(log);
  const approved = await approveWithKey(state, member.id, bridge, NOW); // keyId=key_x
  // second issue returns a DIFFERENT key
  let n = 0;
  const rotBridge: KeyBridge = {
    ...bridge,
    issueKey: async (tenantId, label) => { n++; log.push(`issue:${tenantId}:${label}`); return { id: `key_rot${n}`, key: `olm_ROT${n}` }; },
    revokeKey: async (keyId) => { log.push(`revoke:${keyId}`); },
  };
  const r = await rotateWithKey(approved.state, member.id, rotBridge);
  assert.equal(r.rawKey, "olm_ROT1");
  assert.equal(r.keyId, "key_rot1");
  assert.equal(r.tenantId, "tnt_x");
  const m = getMember(r.state, member.id);
  assert.equal(m?.status, "active"); // still active
  assert.equal(m?.keyId, "key_rot1"); // swapped
  // issue-before-revoke ordering; old key_x revoked
  const issueIdx = log.findIndex((l) => l.startsWith("issue:tnt_x:contract:") && l.includes(":rot"));
  const revokeIdx = log.indexOf("revoke:key_x");
  assert.ok(issueIdx >= 0 && revokeIdx > issueIdx, "must issue new before revoking old");
  assert.ok(!JSON.stringify(r.state).includes("olm_"), "raw key leaked into state (ERR-CONTRACT-002)");
});

test("rotateWithKey on non-active member throws before any bridge call", async () => {
  const { state, member } = pendingState(); // pending
  const log: string[] = [];
  await assert.rejects(() => rotateWithKey(state, member.id, fakeBridge(log)), /active/i);
  assert.equal(log.length, 0);
});
