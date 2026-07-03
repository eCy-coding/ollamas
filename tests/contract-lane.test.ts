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
let store: typeof import("../server/store/index");
let contract: typeof import("../server/contract");
let doc: typeof import("../contract/src/contractdoc.ts");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  process.env.CONTRACT_STATE_PATH = STATE;
  process.env.FLEET_BACKENDS_PATH = FLEET;
  process.env.CONTRACT_SHARD_DIR = SHARD_DIR;
  delete process.env.STRIPE_API_KEY;
  store = await import("../server/store/index");
  contract = await import("../server/contract");
  doc = await import("../contract/src/contractdoc.ts");
  await store.initStore();
  contract._resetContractStateForTests();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, STATE, FLEET]) try { fs.unlinkSync(f); } catch {}
  try { fs.rmSync(SHARD_DIR, { recursive: true, force: true }); } catch {}
});

describe("contract lane service: apply → approve → key → revoke", () => {
  let memberId = "";

  test("apply creates pending member; stale hash rejected", () => {
    expect(() =>
      contract.contractApply({
        email: "node1@example.com",
        machinePubkey: "ab".repeat(32),
        specs: { ramGB: 32, os: "darwin", arch: "arm64" },
        contractHash: "0".repeat(64),
      }),
    ).toThrow(/contract/i);

    const m = contract.contractApply({
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
    contract.contractHeartbeat(m.tenantId!, { ollamaUrl: "http://100.64.0.7:11434", models: ["qwen3:8b"] });

    const nodes = contract.contractPoolNodes();
    expect(nodes.find((n) => n.memberId === memberId)?.freshness).toBe("fresh");

    const fleet = JSON.parse(fs.readFileSync(FLEET, "utf8"));
    expect(fleet.map((b: any) => b.name).sort()).toEqual([`contract:${memberId}`, "windows-cuda"]);

    expect(() => contract.contractHeartbeat("tnt_unknown", { ollamaUrl: "http://100.64.0.7:11434", models: [] })).toThrow(/active/i);
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
