import { test } from "node:test";
import assert from "node:assert/strict";
import { applyForMembership, approveMember, emptyState, getMember } from "./registry.ts";
import { recordHeartbeat, poolNodes, toFleetBackends, mergeFleetBackends } from "./pool.ts";

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

test("mergeFleetBackends tolerates garbage existing file", () => {
  const merged = mergeFleetBackends("garbage" as unknown as unknown[], [{ name: "contract:m_1", url: "http://100.64.0.7:11434", priority: 30 }]);
  assert.equal(merged.length, 1);
});
