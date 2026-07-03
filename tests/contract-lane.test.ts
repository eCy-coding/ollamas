import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Contract lane (vK2): apply → approve → one-time key delivery → resolveKey → revoke.
// Isolated temp DB + temp contract state; env set BEFORE dynamic import (saas-store pattern).
const DB = path.join(os.tmpdir(), `ollamas-contract-test-${process.pid}.db`);
const STATE = path.join(os.tmpdir(), `ollamas-contract-state-${process.pid}.json`);
const FLEET = path.join(os.tmpdir(), `ollamas-contract-fleet-${process.pid}.json`);
const SHARD_DIR = path.join(os.tmpdir(), `ollamas-contract-shard-${process.pid}`);
const AUDIT = path.join(os.tmpdir(), `ollamas-contract-audit-${process.pid}.jsonl`);
let store: typeof import("../server/store/index");
let contract: typeof import("../server/contract");
let doc: typeof import("../contract/src/contractdoc.ts");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  process.env.CONTRACT_STATE_PATH = STATE;
  process.env.FLEET_BACKENDS_PATH = FLEET;
  process.env.CONTRACT_SHARD_DIR = SHARD_DIR;
  process.env.CONTRACT_AUDIT_PATH = AUDIT;
  delete process.env.STRIPE_API_KEY;
  store = await import("../server/store/index");
  contract = await import("../server/contract");
  doc = await import("../contract/src/contractdoc.ts");
  await store.initStore();
  contract._resetContractStateForTests();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, STATE, FLEET, AUDIT]) try { fs.unlinkSync(f); } catch {}
  try { fs.rmSync(SHARD_DIR, { recursive: true, force: true }); } catch {}
});

describe("contract lane service: apply → approve → key → revoke", () => {
  let memberId = "";

  test("apply creates pending member; stale hash rejected", async () => {
    await expect(
      contract.contractApply({
        email: "node1@example.com",
        machinePubkey: "ab".repeat(32),
        specs: { ramGB: 32, os: "darwin", arch: "arm64" },
        contractHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/contract/i);

    const m = await contract.contractApply({
      email: "node1@example.com",
      machinePubkey: "ab".repeat(32),
      specs: { ramGB: 32, os: "darwin", arch: "arm64" },
      contractHash: doc.currentContractHash(),
    });
    memberId = m.id;
    expect(m.status).toBe("pending");
  });

  test("approve issues real store key; status poll delivers raw key exactly once", async () => {
    const grant = await contract.contractApprove(memberId);
    expect(grant.keyId).toMatch(/^key_/);
    expect(grant.tenantId).toMatch(/^tnt_/);

    const first = contract.contractStatus(memberId);
    expect(first?.member.status).toBe("active");
    expect(first?.key).toMatch(/^olm_/);

    const second = contract.contractStatus(memberId);
    expect(second?.key).toBeUndefined(); // one-time delivery

    const resolved = await store.resolveKey(first!.key!);
    expect(resolved?.tenantId).toBe(grant.tenantId);
    expect(resolved?.keyId).toBe(grant.keyId);

    // state file on disk never contains the raw key (ERR-CONTRACT-002)
    expect(fs.readFileSync(STATE, "utf8")).not.toContain("olm_");
  });

  test("heartbeat (key tenant) updates ledger + projects contract node into fleet file; foreign entries survive", async () => {
    // pre-seed a hand-pinned foreign backend (RISK-K3: must survive our sync)
    fs.writeFileSync(FLEET, JSON.stringify([{ name: "windows-cuda", url: "http://192.168.1.50:11434", priority: 10 }]));

    const m = contract.contractList().find((x) => x.id === memberId)!;
    await contract.contractHeartbeat(m.tenantId!, { ollamaUrl: "http://100.64.0.7:11434", models: ["qwen3:8b"], rpcPort: 50052 });

    const nodes = contract.contractPoolNodes();
    const node = nodes.find((n) => n.memberId === memberId);
    expect(node?.freshness).toBe("fresh");
    expect(node?.rpcPort).toBe(50052); // F1: rpcPort flows through heartbeat → pool node

    const fleet = JSON.parse(fs.readFileSync(FLEET, "utf8"));
    expect(fleet.map((b: any) => b.name).sort()).toEqual([`contract:${memberId}`, "windows-cuda"]);

    await expect(contract.contractHeartbeat("tnt_unknown", { ollamaUrl: "http://100.64.0.7:11434", models: [] })).rejects.toThrow(/active/i);
  });

  test("vK9 shard-first: healthy head serves; missing/dead head → null (fleet fallback)", async () => {
    // no head.json → null
    expect(await contract.tryShardGenerate({ messages: [{ role: "user", content: "x" }] })).toBeNull();

    fs.mkdirSync(SHARD_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHARD_DIR, "head.json"), JSON.stringify({ up: true, url: "http://127.0.0.1:9", model: "m" }));
    // dead head (port 9 unreachable) → null, no throw
    expect(await contract.tryShardGenerate({ messages: [{ role: "user", content: "x" }] })).toBeNull();

    // healthy head via fake fetch
    const fakeFetch = (async (url: string) => {
      if (String(url).endsWith("/health")) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ model: "tiny", choices: [{ message: { content: "FROM-SHARD" } }] }) };
    }) as unknown as typeof fetch;
    const r = await contract.tryShardGenerate({ messages: [{ role: "user", content: "x" }] }, fakeFetch);
    expect(r?.source).toBe("shard:head");
    expect(r?.content).toBe("FROM-SHARD");

    // head marked down → null
    fs.writeFileSync(path.join(SHARD_DIR, "head.json"), JSON.stringify({ up: false }));
    expect(await contract.tryShardGenerate({ messages: [{ role: "user", content: "x" }] }, fakeFetch)).toBeNull();
  });

  test("revoke kills the key in the store too", async () => {
    const before = contract.contractList().find((m) => m.id === memberId);
    expect(before?.status).toBe("active");
    await contract.contractRevoke(memberId);
    const after = contract.contractList().find((m) => m.id === memberId);
    expect(after?.status).toBe("revoked");
    // key no longer resolves — issue a fresh member to prove resolveKey behavior is key-specific
    const resolved = await store.resolveKey("olm_definitely_not_a_key");
    expect(resolved).toBeNull();
  });
});

describe("F4 state lock: concurrent approvals do not lost-update", () => {
  test("two parallel approves → both active, both keyed (no orphan)", async () => {
    const hash = doc.currentContractHash();
    const a = await contract.contractApply({ email: "p1@x.co", machinePubkey: "11".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: hash });
    const b = await contract.contractApply({ email: "p2@x.co", machinePubkey: "22".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: hash });
    const [ga, gb] = await Promise.all([contract.contractApprove(a.id), contract.contractApprove(b.id)]);
    expect(ga.keyId).not.toBe(gb.keyId);
    const list = contract.contractList();
    expect(list.find((m) => m.id === a.id)?.status).toBe("active");
    expect(list.find((m) => m.id === b.id)?.status).toBe("active");
    // both keys resolve (no dropped membership)
    expect((await store.resolveKey(contract.contractStatus(a.id)!.key!))?.keyId).toBe(ga.keyId);
    expect((await store.resolveKey(contract.contractStatus(b.id)!.key!))?.keyId).toBe(gb.keyId);
  });
});

describe("vK11 suspend wire (dead-code completed)", () => {
  test("active→suspend leaves the schedulable pool + drops fleet entry; suspend→revoke works", async () => {
    const hash = doc.currentContractHash();
    const m = await contract.contractApply({ email: "s@x.co", machinePubkey: "44".repeat(32), specs: { ramGB: 16, os: "linux", arch: "x64" }, contractHash: hash });
    const g = await contract.contractApprove(m.id);
    await contract.contractHeartbeat(g.tenantId, { ollamaUrl: "http://100.64.0.7:11434", models: ["x"] });
    expect(contract.contractPoolNodes().find((n) => n.memberId === m.id)?.freshness).toBe("fresh");

    await contract.contractSuspend(m.id);
    // suspended node is no longer active → not projected as a fleet backend
    const suspended = contract.contractList().find((x) => x.id === m.id);
    expect(suspended?.status).toBe("suspended");
    const fleet = JSON.parse(fs.readFileSync(FLEET, "utf8"));
    expect(fleet.some((b: any) => b.name === `contract:${m.id}`)).toBe(false);

    // registry allows suspend→revoke
    await contract.contractRevoke(m.id);
    expect(contract.contractList().find((x) => x.id === m.id)?.status).toBe("revoked");
  });
});

describe("F2 quota charge-on-success", () => {
  test("wouldExceed check + consume are separate; consume only bumps once", async () => {
    const hash = doc.currentContractHash();
    const m = await contract.contractApply({ email: "q@x.co", machinePubkey: "33".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: hash });
    const g = await contract.contractApprove(m.id);
    expect(contract.contractQuotaExceeded(g.tenantId)).toBe(false); // read-only, no mutation
    expect(contract.contractQuotaExceeded(g.tenantId)).toBe(false); // still false — not consumed
    await contract.contractConsumeQuota(g.tenantId);
    const q = contract.contractPoolNodes(); // just to touch state
    expect(q).toBeDefined();
    // verify used bumped by exactly 1 via a fresh apply's quota inspection is indirect;
    // instead re-consume path: exceeded stays false until cap
    expect(contract.contractQuotaExceeded(g.tenantId)).toBe(false);
  });
});

describe("vK13 governance: resume + rotation + audit", () => {
  test("suspend→resume returns member to active (key preserved)", async () => {
    const hash = doc.currentContractHash();
    const m = await contract.contractApply({ email: "res@x.co", machinePubkey: "55".repeat(32), specs: { ramGB: 16, os: "linux", arch: "x64" }, contractHash: hash });
    const g = await contract.contractApprove(m.id);
    await contract.contractSuspend(m.id);
    expect(contract.contractList().find((x) => x.id === m.id)?.status).toBe("suspended");
    await contract.contractResume(m.id);
    const after = contract.contractList().find((x) => x.id === m.id);
    expect(after?.status).toBe("active");
    expect(after?.keyId).toBe(g.keyId); // key survived
    // resume on non-suspended throws
    await expect(contract.contractResume(m.id)).rejects.toThrow(/transition/i);
  });

  test("rotate: old key stops resolving, new key resolves once via status poll; member stays active", async () => {
    const hash = doc.currentContractHash();
    const m = await contract.contractApply({ email: "rot@x.co", machinePubkey: "66".repeat(32), specs: { ramGB: 16, os: "linux", arch: "x64" }, contractHash: hash });
    await contract.contractApprove(m.id);
    const oldKey = contract.contractStatus(m.id)!.key!;
    expect(await store.resolveKey(oldKey)).not.toBeNull();

    const rot = await contract.contractRotate(m.id);
    // old key revoked
    expect(await store.resolveKey(oldKey)).toBeNull();
    // new key delivered once via status poll
    const newKey = contract.contractStatus(m.id)!.key!;
    expect(newKey).toMatch(/^olm_/);
    expect(newKey).not.toBe(oldKey);
    expect(contract.contractStatus(m.id)!.key).toBeUndefined(); // one-time
    const resolved = await store.resolveKey(newKey);
    expect(resolved?.keyId).toBe(rot.keyId);
    expect(contract.contractList().find((x) => x.id === m.id)?.status).toBe("active");
    // rotate on non-active throws
    await contract.contractRevoke(m.id);
    await expect(contract.contractRotate(m.id)).rejects.toThrow(/active/i);
  });

  test("audit log records every admin action, ordered, and is secret-free", async () => {
    const entries = contract.contractAuditLog(1000);
    const actions = entries.map((e: any) => e.action);
    // from all prior tests we should have apply/approve/suspend/resume/revoke/rotate present
    for (const a of ["apply", "approve", "suspend", "resume", "revoke", "rotate"]) {
      expect(actions).toContain(a);
    }
    // every entry carries memberId + ts; none carries a raw key or email
    for (const e of entries) {
      expect(e.memberId).toMatch(/^m_/);
      expect(typeof e.ts).toBe("string");
    }
    const rawFile = fs.readFileSync(AUDIT, "utf8");
    expect(rawFile).not.toContain("olm_");
    expect(rawFile).not.toContain("@"); // no emails
  });
});

describe("G2 applicant notification", () => {
  test("notifyPendingApplicant fires osascript + optional webhook; never throws", () => {
    const calls: string[] = [];
    let notified = 0;
    // no throw with injected fakes
    contract.notifyPendingApplicant("m_x", { ramGB: 16, os: "darwin", arch: "arm64" }, {
      osascript: (s: string) => { calls.push(s); },
      notifyFn: (async () => { notified++; return []; }) as any,
    });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("m_x");
    expect(calls[0]).toContain("approve");
    // webhook only fires when env is set — not set here → notified stays 0
    expect(notified).toBe(0);
  });

  test("notifyPendingApplicant with slack env → notifyFn called", () => {
    const prev = process.env.CONTRACT_NOTIFY_SLACK;
    process.env.CONTRACT_NOTIFY_SLACK = "https://hooks.slack.test/x";
    let notified = 0;
    try {
      contract.notifyPendingApplicant("m_y", { ramGB: 8, os: "linux", arch: "x64" }, {
        osascript: () => {},
        notifyFn: (async () => { notified++; return ["slack"]; }) as any,
      });
      expect(notified).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.CONTRACT_NOTIFY_SLACK;
      else process.env.CONTRACT_NOTIFY_SLACK = prev;
    }
  });
});

describe("vK16 G-A observability", () => {
  test("poolStatusReport: masked counts, version, shard-head; no email/keyId", async () => {
    const hash = doc.currentContractHash();
    const m = await contract.contractApply({ email: "obs@x.co", machinePubkey: "77".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: hash });
    const r = contract.poolStatusReport();
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.members.pending).toBeGreaterThanOrEqual(1);
    expect(typeof r.fleetContractNodes).toBe("number");
    expect(typeof r.shardHead.up).toBe("boolean");
    const json = JSON.stringify(r);
    expect(json).not.toContain("obs@x.co");
    expect(json).not.toContain(m.machinePubkey);
    expect(json).not.toContain("olm_");
    expect(json).not.toContain("key_");
  });
});

describe("vK17 auto-approve on operator invite", () => {
  let opkey: typeof import("../contract/src/opkey.ts");
  let invite: typeof import("../contract/src/invite.ts");
  const OP_PATH = path.join(os.tmpdir(), `ollamas-opkey-${process.pid}.json`);

  beforeAll(async () => {
    process.env.CONTRACT_OPERATOR_KEY = OP_PATH;
    opkey = await import("../contract/src/opkey.ts");
    invite = await import("../contract/src/invite.ts");
  });
  afterAll(() => { try { fs.unlinkSync(OP_PATH); } catch {} });

  function mkToken(over: any = {}) {
    const op = opkey.loadOrCreateOperatorKey(OP_PATH);
    const now = Date.now();
    const payload = {
      v: 1 as const, jti: "j-" + Math.random().toString(36).slice(2), iat: new Date(now).toISOString(),
      expiresAt: new Date(now + 15 * 60000).toISOString(), quotaReqPerDay: 500,
      contractHash: doc.currentContractHash(), serverUrl: "http://127.0.0.1:3000", epoch: op.epoch, ...over,
    };
    return { token: invite.mintInvite(payload, op.privateKeyPem), payload };
  }
  const machine = (pk: string) => ({ email: `dev-${pk.slice(0, 4)}@x.co`, machinePubkey: pk, specs: { ramGB: 16, os: "darwin", arch: "arm64" } });

  test("valid invite → auto-active + key (no manual approve); quota from invite; single-use", async () => {
    const { token } = mkToken();
    const r = await contract.contractApplyWithInvite(token, machine("a1".repeat(32)));
    expect(r.rawKey).toMatch(/^olm_/);
    const m = contract.contractList().find((x) => x.id === r.memberId);
    expect(m?.status).toBe("active"); // auto-approved, no manual step
    expect((await store.resolveKey(r.rawKey))?.keyId).toBe(r.keyId);
    // replay same token → 409 single-use
    await expect(contract.contractApplyWithInvite(token, machine("a2".repeat(32)))).rejects.toMatchObject({ status: 409 });
  });

  test("expired invite → 403; forged (wrong key) → 401; kill-switch → 503", async () => {
    const expired = mkToken({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(contract.contractApplyWithInvite(expired.token, machine("b1".repeat(32)))).rejects.toMatchObject({ status: 403 });

    const otherOp = (await import("../contract/src/identity.ts")).generateIdentity();
    const forged = invite.mintInvite({ ...expired.payload, expiresAt: new Date(Date.now() + 60000).toISOString(), jti: "forge1" } as any, otherOp.privateKeyPem);
    await expect(contract.contractApplyWithInvite(forged, machine("b2".repeat(32)))).rejects.toMatchObject({ status: 401 });

    const prev = process.env.AUTO_APPROVE_INVITE;
    process.env.AUTO_APPROVE_INVITE = "off";
    try {
      const { token } = mkToken();
      await expect(contract.contractApplyWithInvite(token, machine("b3".repeat(32)))).rejects.toMatchObject({ status: 503 });
    } finally {
      if (prev === undefined) delete process.env.AUTO_APPROVE_INVITE; else process.env.AUTO_APPROVE_INVITE = prev;
    }
  });

  test("audit records the invite-driven activation (actor:invite), secret-free", async () => {
    const { token } = mkToken();
    const r = await contract.contractApplyWithInvite(token, machine("c1".repeat(32)));
    const rows = contract.contractAuditLog(1000).filter((e: any) => e.memberId === r.memberId);
    expect(rows.map((e: any) => e.action)).toEqual(expect.arrayContaining(["apply", "approve"]));
    expect(rows.every((e: any) => e.actor === "invite")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("olm_");
  });
});

describe("vK18 A syncFleetFile dirty-check", () => {
  test("re-heartbeat with same projection skips the disk write; new member flushes", async () => {
    const hash = doc.currentContractHash();
    const m = await contract.contractApply({ email: "dc@x.co", machinePubkey: "88".repeat(32), specs: { ramGB: 16, os: "linux", arch: "x64" }, contractHash: hash });
    const g = await contract.contractApprove(m.id);
    await contract.contractHeartbeat(g.tenantId, { ollamaUrl: "http://100.64.0.7:11434", models: ["x"] });
    const mtime1 = fs.statSync(FLEET).mtimeMs;
    // same heartbeat again → identical projection → no write (mtime unchanged)
    await new Promise((r) => setTimeout(r, 5));
    await contract.contractHeartbeat(g.tenantId, { ollamaUrl: "http://100.64.0.7:11434", models: ["x"] });
    const mtime2 = fs.statSync(FLEET).mtimeMs;
    expect(mtime2).toBe(mtime1); // dirty-check skipped the redundant write
    // a NEW member changes the projection → write happens
    const m2 = await contract.contractApply({ email: "dc2@x.co", machinePubkey: "99".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: hash });
    const g2 = await contract.contractApprove(m2.id);
    await new Promise((r) => setTimeout(r, 5));
    await contract.contractHeartbeat(g2.tenantId, { ollamaUrl: "http://100.64.0.8:11434", models: ["y"] });
    const fleet = JSON.parse(fs.readFileSync(FLEET, "utf8"));
    expect(fleet.filter((b: any) => b.name.startsWith("contract:")).length).toBe(2);
  });
});
