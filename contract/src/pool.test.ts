import { test } from "node:test";
import assert from "node:assert/strict";
import { applyForMembership, approveMember, emptyState, getMember } from "./registry.ts";
import { recordHeartbeat, poolNodes, toFleetBackends, mergeFleetBackends, consumeQuota, wouldExceedQuota } from "./pool.ts";

const HASH = "c".repeat(64);
const NOW = "2026-07-03T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function activeMember(email = "a@example.com", pubkey = "aa".repeat(32)) {
  const { state, member } = applyForMembership(
    emptyState(),
    { email, machinePubkey: pubkey, specs: { ramGB: 32, os: "darwin", arch: "arm64" }, contractHash: HASH },
    HASH,
    NOW,
  );
  return { state: approveMember(state, member.id, { keyId: "k1", tenantId: "t1" }, NOW), id: member.id };
}

const HB = { ollamaUrl: "http://100.64.0.7:11434", models: ["qwen3:8b"], load: 0.2 };

test("recordHeartbeat updates active member capabilities + lastHeartbeat", () => {
  const { state, id } = activeMember();
  const next = recordHeartbeat(state, id, HB, NOW);
  const m = getMember(next, id);
  assert.equal(m?.lastHeartbeat, NOW);
  assert.equal(m?.capabilities?.ollamaUrl, HB.ollamaUrl);
  assert.deepEqual(m?.capabilities?.models, ["qwen3:8b"]);
});

test("recordHeartbeat rejects non-active member and non-private/loopback-unsafe URL is kept as-is string", () => {
  const { state, member } = applyForMembership(
    emptyState(),
    { email: "p@example.com", machinePubkey: "cc".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: HASH },
    HASH,
    NOW,
  );
  assert.throws(() => recordHeartbeat(state, member.id, HB, NOW), /active/i);
  assert.throws(() => recordHeartbeat(state, "m_nope", HB, NOW), /not found/i);
});

test("recordHeartbeat rejects malformed url", () => {
  const { state, id } = activeMember();
  assert.throws(() => recordHeartbeat(state, id, { ...HB, ollamaUrl: "not a url" }, NOW), /url/i);
});

test("recordHeartbeat SSRF guard: private ok, public/metadata rejected (F3)", () => {
  const { state, id } = activeMember();
  // private/mesh accepted
  for (const u of ["http://127.0.0.1:11434", "http://192.168.1.9:11434", "http://100.64.0.7:11434", "http://10.0.0.5:11434"]) {
    assert.doesNotThrow(() => recordHeartbeat(state, id, { ...HB, ollamaUrl: u }, NOW), u);
  }
  // public / cloud-metadata / external hostname rejected
  for (const u of ["http://169.254.169.254/latest/meta-data", "http://8.8.8.8:11434", "http://example.com:11434", "http://0.0.0.0:11434"]) {
    assert.throws(() => recordHeartbeat(state, id, { ...HB, ollamaUrl: u }, NOW), /private|SSRF/i, u);
  }
});

test("wouldExceedQuota: read-only check, no mutation; day rollover; active-only (F2)", () => {
  const { state: s0, id } = activeMember();
  const withQuota = { members: s0.members.map((m) => (m.id === id ? { ...m, quota: { reqPerDay: 1, usedToday: 0, dayUtc: "2026-07-03" } } : m)) };
  assert.equal(wouldExceedQuota(withQuota, "t1", "2026-07-03"), false);
  const consumed = consumeQuota(withQuota, "t1", "2026-07-03");
  assert.equal(wouldExceedQuota(consumed, "t1", "2026-07-03"), true); // cap reached
  assert.equal(wouldExceedQuota(consumed, "t1", "2026-07-04"), false); // next day resets
  // wouldExceedQuota did not mutate
  assert.equal(getMember(withQuota, id)?.quota.usedToday, 0);
  assert.throws(() => wouldExceedQuota(consumed, "tnt_nope", "2026-07-03"), /membership/i);
});

test("poolNodes reports freshness and sorts fresh-first then by score", () => {
  const a = activeMember("a@example.com", "aa".repeat(32));
  let state = recordHeartbeat(a.state, a.id, HB, NOW);
  const nodes = poolNodes(state, NOW_MS);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.freshness, "fresh");
  assert.ok((nodes[0]?.score ?? 0) > 0);
});

test("toFleetBackends: only fresh active members with url; contract: prefix; stable priority", () => {
  const a = activeMember();
  const withHb = recordHeartbeat(a.state, a.id, HB, NOW);
  const backends = toFleetBackends(withHb, NOW_MS);
  assert.equal(backends.length, 1);
  assert.equal(backends[0]?.name, `contract:${a.id}`);
  assert.equal(backends[0]?.url, HB.ollamaUrl);
  assert.equal(typeof backends[0]?.priority, "number");

  // no heartbeat → excluded
  assert.equal(toFleetBackends(a.state, NOW_MS).length, 0);
  // stale → excluded
  const later = NOW_MS + 10 * 60_000;
  assert.equal(toFleetBackends(withHb, later).length, 0);
});

test("mergeFleetBackends preserves foreign entries, replaces only contract:* (RISK-K3)", () => {
  const existing = [
    { name: "windows-cuda", url: "http://192.168.1.50:11434", priority: 10 },
    { name: "contract:m_old", url: "http://100.64.0.9:11434", priority: 30 },
  ];
  const merged = mergeFleetBackends(existing, [{ name: "contract:m_new", url: "http://100.64.0.7:11434", priority: 30 }]);
  assert.deepEqual(merged.map((b) => b.name).sort(), ["contract:m_new", "windows-cuda"]);
});

test("toFleetBackends ranks by capability score: better node gets lower priority number (vK4)", () => {
  const a = applyForMembership(
    emptyState(),
    { email: "big@example.com", machinePubkey: "aa".repeat(32), specs: { ramGB: 64, os: "darwin", arch: "arm64" }, contractHash: HASH },
    HASH,
    NOW,
  );
  const b = applyForMembership(a.state, { email: "small@example.com", machinePubkey: "bb".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: HASH }, HASH, NOW);
  let state = approveMember(b.state, a.member.id, { keyId: "k1", tenantId: "t1" }, NOW);
  state = approveMember(state, b.member.id, { keyId: "k2", tenantId: "t2" }, NOW);
  state = recordHeartbeat(state, a.member.id, { ...HB, ollamaUrl: "http://100.64.0.1:11434" }, NOW);
  state = recordHeartbeat(state, b.member.id, { ...HB, ollamaUrl: "http://100.64.0.2:11434" }, NOW);
  const backends = toFleetBackends(state, NOW_MS);
  assert.equal(backends[0]?.name, `contract:${a.member.id}`); // 64GB first
  assert.equal(backends[0]?.priority, 30);
  assert.equal(backends[1]?.name, `contract:${b.member.id}`);
  assert.equal(backends[1]?.priority, 31);
});

test("consumeQuota (vK4): counts, exhausts, day-rollover resets, active-only", () => {
  const { state: s0, id } = activeMember();
  const withQuota = {
    members: s0.members.map((m) => (m.id === id ? { ...m, quota: { reqPerDay: 2, usedToday: 0, dayUtc: "2026-07-03" } } : m)),
  };
  const s1 = consumeQuota(withQuota, "t1", "2026-07-03");
  const s2 = consumeQuota(s1, "t1", "2026-07-03");
  assert.throws(() => consumeQuota(s2, "t1", "2026-07-03"), /quota/i);
  // next day resets
  const s3 = consumeQuota(s2, "t1", "2026-07-04");
  assert.equal(getMember(s3, id)?.quota.usedToday, 1);
  assert.equal(getMember(s3, id)?.quota.dayUtc, "2026-07-04");
  // unknown tenant
  assert.throws(() => consumeQuota(s2, "tnt_nope", "2026-07-03"), /membership/i);
});

test("mergeFleetBackends tolerates garbage existing file", () => {
  const merged = mergeFleetBackends("garbage" as unknown as unknown[], [{ name: "contract:m_1", url: "http://100.64.0.7:11434", priority: 30 }]);
  assert.equal(merged.length, 1);
});
