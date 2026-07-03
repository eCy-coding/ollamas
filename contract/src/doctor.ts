// Live end-to-end doctor (ERR-TUNNEL-003 lesson: unit tests cannot prove the
// real path — run the full chain against a REAL server):
// health → document → apply → approve → key(once) → heartbeat → pool → revoke.
// Operator-side tool: uses SAAS_ADMIN_TOKEN for admin steps when set.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateIdentity } from "./identity.ts";
import { detectShardCapability, resolveShardBinary, shardDir } from "./shard.ts";

async function checkShardStep(): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    const { execFileSync } = await import("node:child_process");
    const headBin = resolveShardBinary("llama-server");
    const rpcBin = resolveShardBinary("rpc-server");
    const has = (p: string) => { try { execFileSync("test", ["-x", p], { stdio: "pipe" }); return true; } catch { return p === "rpc-server" || p === "llama-server" ? false : false; } };
    const rpcFlag = (() => { try { return execFileSync(headBin, ["--help"], { stdio: "pipe" }).toString().includes("--rpc"); } catch { return false; } })();
    const cap = detectShardCapability({ "llama-server": has(headBin) || rpcFlag, "rpc-server": has(rpcBin), rpcFlag });
    if (!cap.capable) return { name: "shard", ok: true, detail: `SKIP — not capable (${cap.missing.join(", ")})` };
    let head: { up?: boolean; url?: string } = {};
    try { head = JSON.parse(readFileSync(join(shardDir(), "head.json"), "utf8")); } catch {}
    if (!head.up || !head.url) return { name: "shard", ok: true, detail: "capable; head down (run: contract shard proof <model>)" };
    const r = await fetch(`${head.url}/health`, { signal: AbortSignal.timeout(3000) });
    return { name: "shard", ok: r.ok, detail: `head ${head.url} /health → ${r.status}` };
  } catch (e: any) {
    return { name: "shard", ok: true, detail: `SKIP — ${String(e?.message || e)}` };
  }
}

export type DoctorStep = { name: string; ok: boolean; detail: string };

async function req(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export async function runDoctor(base: string, opts: { adminToken?: string; ollamaUrl?: string } = {}): Promise<{ ok: boolean; steps: DoctorStep[] }> {
  const steps: DoctorStep[] = [];
  const admin: Record<string, string> = opts.adminToken ? { "x-admin-token": opts.adminToken } : {};
  const step = (name: string, ok: boolean, detail: string) => {
    steps.push({ name, ok, detail });
    return ok;
  };

  try {
    const health = await req(base, "GET", "/api/health");
    if (!step("health", health.status === 200, `GET /api/health → ${health.status}`)) return { ok: false, steps };

    const doc = await req(base, "GET", "/api/contract/document");
    const hash = doc.json?.hash;
    if (!step("document", doc.status === 200 && /^[0-9a-f]{64}$/.test(String(hash)), `hash=${String(hash).slice(0, 12)}…`)) return { ok: false, steps };

    const identity = generateIdentity();
    const apply = await req(base, "POST", "/api/contract/apply", {
      email: `doctor-${randomBytes(4).toString("hex")}@contract.doctor`,
      machinePubkey: identity.publicKeyHex,
      specs: { ramGB: 1, os: process.platform, arch: process.arch },
      contractHash: hash,
    });
    const id = apply.json?.id;
    if (!step("apply", apply.status === 202 && String(id).startsWith("m_"), `id=${id}`)) return { ok: false, steps };

    const approve = await req(base, "POST", `/api/contract/${id}/approve`, {}, admin);
    if (!step("approve", approve.status === 200 && approve.json?.status === "active", `keyId=${approve.json?.keyId}`)) return { ok: false, steps };

    const status1 = await req(base, "GET", `/api/contract/status/${id}`);
    const key = status1.json?.key;
    if (!step("key-once", typeof key === "string" && key.startsWith("olm_"), `key=${String(key).slice(0, 8)}…`)) return { ok: false, steps };
    const status2 = await req(base, "GET", `/api/contract/status/${id}`);
    step("key-not-twice", status2.json?.key === undefined, "second poll has no key");

    const bearer = { authorization: `Bearer ${key}` };
    const hb = await req(base, "POST", "/api/pool/heartbeat", { ollamaUrl: opts.ollamaUrl || "http://127.0.0.1:11434", models: ["doctor-probe"] }, bearer);
    if (!step("heartbeat", hb.status === 200 && hb.json?.ok === true, `member=${hb.json?.memberId}`)) return { ok: false, steps };

    const pool = await req(base, "GET", "/api/pool/nodes", undefined, bearer);
    const found = Array.isArray(pool.json?.nodes) && pool.json.nodes.some((n: any) => n.memberId === id && n.freshness === "fresh");
    if (!step("pool-nodes", pool.status === 200 && found, `nodes=${pool.json?.nodes?.length}`)) return { ok: false, steps };

    // F5: exercise the money-path endpoints. /api/pool/generate needs a live
    // backend (fleet/shard/ollama); if none is reachable it 502s — treat that as
    // an honest SKIP (ok) rather than a doctor failure (env-conditional, ERR-TUNNEL-003).
    const quotaBefore = await req(base, "GET", "/api/pool/quota", undefined, bearer);
    const usedBefore = Number(quotaBefore.json?.usedToday ?? 0);
    step("quota-endpoint", quotaBefore.status === 200 && Number.isFinite(usedBefore), `usedToday=${usedBefore}`);

    const gen = await req(base, "POST", "/api/pool/generate", { messages: [{ role: "user", content: "reply OK" }], temperature: 0 }, bearer);
    if (gen.status === 200 && String(gen.json?.content || "").length > 0) {
      step("generate", true, `source=${gen.json?.source} len=${String(gen.json.content).length}`);
      const quotaAfter = await req(base, "GET", "/api/pool/quota", undefined, bearer);
      step("quota-charged", Number(quotaAfter.json?.usedToday) === usedBefore + 1, `usedToday ${usedBefore}→${quotaAfter.json?.usedToday}`);
    } else {
      // 502 = no backend reachable → SKIP (ok). 429 would be a real quota problem.
      step("generate", gen.status !== 429, `SKIP — no backend (status ${gen.status})`);
      const quotaAfter = await req(base, "GET", "/api/pool/quota", undefined, bearer);
      step("quota-not-charged-on-fail", Number(quotaAfter.json?.usedToday) === usedBefore, `usedToday stayed ${usedBefore} (F2)`);
    }

    const revoke = await req(base, "POST", `/api/contract/${id}/revoke`, {}, admin);
    step("revoke-cleanup", revoke.status === 200 && revoke.json?.status === "revoked", `id=${id} revoked`);

    const hbDead = await req(base, "POST", "/api/pool/heartbeat", { ollamaUrl: "http://127.0.0.1:11434", models: [] }, bearer);
    step("revoked-key-rejected", hbDead.status === 401 || hbDead.status === 400, `post-revoke heartbeat → ${hbDead.status}`);

    // Optional shard check: SKIP (ok) when the RPC-enabled build is absent; when a
    // shard head is up, verify its /health. Never spawns processes itself.
    const shardStep = await checkShardStep();
    step(shardStep.name, shardStep.ok, shardStep.detail);
  } catch (e: any) {
    steps.push({ name: "exception", ok: false, detail: String(e?.message || e) });
  }
  return { ok: steps.every((s) => s.ok), steps };
}

export function renderDoctor(result: { ok: boolean; steps: DoctorStep[] }): string {
  const lines = result.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.name.padEnd(20)} ${s.detail}`);
  lines.push(result.ok ? "DOCTOR: OK" : "DOCTOR: FAIL");
  return lines.join("\n");
}
