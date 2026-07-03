import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  applyForMembership,
  approveMember,
  rejectMember,
  revokeMember,
  suspendMember,
  resumeMember,
  rotateMemberKey,
  isInviteUsed,
  markInviteUsed,
  pruneExpiredInvites,
  getMember,
  listByStatus,
} from "./registry.ts";

const HASH = "c".repeat(64);
const NOW = "2026-07-03T10:00:00.000Z";

function validInput(over: Record<string, unknown> = {}) {
  return {
    email: "node1@example.com",
    machinePubkey: "aa".repeat(32),
    specs: { ramGB: 32, os: "darwin", arch: "arm64" },
    contractHash: HASH,
    ...over,
  };
}

test("apply creates pending member with quota defaults", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  assert.equal(member.status, "pending");
  assert.match(member.id, /^m_[0-9a-f]{16}$/);
  assert.equal(member.appliedAt, NOW);
  assert.ok(member.quota.reqPerDay > 0);
  assert.equal(member.quota.usedToday, 0);
  assert.equal(state.members.length, 1);
});

test("apply rejects stale contract hash (re-accept required)", () => {
  assert.throws(
    () => applyForMembership(emptyState(), validInput({ contractHash: "d".repeat(64) }), HASH, NOW),
    /contract/i,
  );
});

test("apply rejects invalid email and bad specs", () => {
  assert.throws(() => applyForMembership(emptyState(), validInput({ email: "not-an-email" }), HASH, NOW), /email/i);
  assert.throws(
    () => applyForMembership(emptyState(), validInput({ specs: { ramGB: 0, os: "darwin", arch: "arm64" } }), HASH, NOW),
    /ram/i,
  );
});

test("apply rejects duplicate machine pubkey while pending/active", () => {
  const { state } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  assert.throws(() => applyForMembership(state, validInput({ email: "other@example.com" }), HASH, NOW), /pubkey/i);
});

test("approve moves pending→active and records keyId/tenantId", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  const s2 = approveMember(state, member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  const m = getMember(s2, member.id);
  assert.equal(m?.status, "active");
  assert.equal(m?.keyId, "k1");
  assert.equal(m?.tenantId, "t1");
  assert.equal(m?.approvedAt, NOW);
});

test("approve on non-pending member throws", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  const s2 = approveMember(state, member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  assert.throws(() => approveMember(s2, member.id, { keyId: "k2", tenantId: "t1" }, NOW), /transition/i);
});

test("reject moves pending→rejected; revoke works from active and suspended", () => {
  const a = applyForMembership(emptyState(), validInput(), HASH, NOW);
  const rejected = rejectMember(a.state, a.member.id, NOW);
  assert.equal(getMember(rejected, a.member.id)?.status, "rejected");

  const b = applyForMembership(emptyState(), validInput({ email: "b@example.com", machinePubkey: "bb".repeat(32) }), HASH, NOW);
  const active = approveMember(b.state, b.member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  const suspended = suspendMember(active, b.member.id);
  assert.equal(getMember(suspended, b.member.id)?.status, "suspended");
  const { state: revoked, keyId } = revokeMember(suspended, b.member.id);
  assert.equal(getMember(revoked, b.member.id)?.status, "revoked");
  assert.equal(keyId, "k1");
});

test("revoke on pending throws; unknown id throws", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  assert.throws(() => revokeMember(state, member.id), /transition/i);
  assert.throws(() => rejectMember(state, "m_nope", NOW), /not found/i);
});

test("resumeMember: suspended→active (keyId/tenantId preserved); non-suspended throws (vK13)", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  const active = approveMember(state, member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  const suspended = suspendMember(active, member.id);
  const resumed = resumeMember(suspended, member.id);
  const m = getMember(resumed, member.id);
  assert.equal(m?.status, "active");
  assert.equal(m?.keyId, "k1"); // key survives suspend/resume
  assert.equal(m?.tenantId, "t1");
  assert.throws(() => resumeMember(active, member.id), /transition/i); // active is not suspended
  assert.throws(() => resumeMember(active, "m_nope"), /not found/i);
});

test("rotateMemberKey: active swaps keyId, keeps tenant; non-active throws (vK13)", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  const active = approveMember(state, member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  const rotated = rotateMemberKey(active, member.id, "k2");
  const m = getMember(rotated, member.id);
  assert.equal(m?.keyId, "k2");
  assert.equal(m?.tenantId, "t1");
  assert.equal(m?.status, "active");
  assert.throws(() => rotateMemberKey(state, member.id, "k2"), /active/i); // pending can't rotate
});

test("listByStatus filters", () => {
  const { state, member } = applyForMembership(emptyState(), validInput(), HASH, NOW);
  const s2 = approveMember(state, member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  assert.equal(listByStatus(s2, "active").length, 1);
  assert.equal(listByStatus(s2, "pending").length, 0);
});

test("state is not mutated in place (pure)", () => {
  const s0 = emptyState();
  const { state: s1, member } = applyForMembership(s0, validInput(), HASH, NOW);
  assert.equal(s0.members.length, 0);
  const s2 = approveMember(s1, member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  assert.equal(getMember(s1, member.id)?.status, "pending");
  assert.equal(getMember(s2, member.id)?.status, "active");
});

test("usedInvites: mark → isInviteUsed true; prune drops expired (vK17)", () => {
  const s0 = emptyState();
  assert.equal(isInviteUsed(s0, "j1"), false);
  const s1 = markInviteUsed(s0, { jti: "j1", memberId: "m_1", redeemedAt: NOW, expiresAt: "2026-07-03T10:15:00.000Z" });
  assert.equal(isInviteUsed(s1, "j1"), true);
  const s2 = markInviteUsed(s1, { jti: "j2", memberId: "m_2", redeemedAt: NOW, expiresAt: "2026-07-03T09:00:00.000Z" }); // already past
  const pruned = pruneExpiredInvites(s2, Date.parse("2026-07-03T10:00:00.000Z"));
  assert.equal(isInviteUsed(pruned, "j1"), true);  // still valid window
  assert.equal(isInviteUsed(pruned, "j2"), false); // expired → pruned
});
