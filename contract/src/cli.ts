#!/usr/bin/env node
// contract CLI — applicant side (apply/status) + T0 admin side (approve/reject/revoke/list).
// Zero-dep: node fetch + node:util parseArgs. Admin commands need SAAS_ADMIN_TOKEN
// (same guard as /api/saas). Server default: http://127.0.0.1:3000 (OLLAMAS_URL).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, totalmem, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { generateIdentity, type Identity } from "./identity.ts";

const BASE = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const IDENTITY_PATH = process.env.CONTRACT_IDENTITY_PATH || join(homedir(), ".ollamas", "contract-identity.json");

function loadOrCreateIdentity(): Identity {
  try {
    return JSON.parse(readFileSync(IDENTITY_PATH, "utf8")) as Identity;
  } catch {
    const id = generateIdentity();
    mkdirSync(dirname(IDENTITY_PATH), { recursive: true });
    writeFileSync(IDENTITY_PATH, JSON.stringify(id, null, 2) + "\n", { mode: 0o600 });
    return id;
  }
}

async function http(method: string, path: string, body?: unknown, admin = false): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (admin) {
    const token = process.env.SAAS_ADMIN_TOKEN || "";
    if (token) headers["x-admin-token"] = token;
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.error || res.statusText}`);
  return json;
}

export function localSpecs(): { ramGB: number; os: string; arch: string } {
  return { ramGB: Math.round(totalmem() / 1024 ** 3), os: platform(), arch: arch() };
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: "string" }, json: { type: "boolean", default: false } },
  });
  const [cmd, id] = positionals;
  const out = (o: unknown) => console.log(values.json ? JSON.stringify(o) : JSON.stringify(o, null, 2));

  switch (cmd) {
    case "document": {
      const doc = await http("GET", "/api/contract/document");
      console.log(doc.text);
      console.error(`version=${doc.version} hash=${doc.hash}`);
      return 0;
    }
    case "apply": {
      if (!values.email) { console.error("usage: contract apply --email you@example.com"); return 2; }
      const identity = loadOrCreateIdentity();
      const doc = await http("GET", "/api/contract/document");
      const r = await http("POST", "/api/contract/apply", {
        email: values.email,
        machinePubkey: identity.publicKeyHex,
        specs: localSpecs(),
        contractHash: doc.hash, // accept-by-hash = signing the exact document text
      });
      out(r);
      console.error(`applied. poll: contract status ${r.id}`);
      return 0;
    }
    case "status": {
      if (!id) { console.error("usage: contract status <m_id>"); return 2; }
      const r = await http("GET", `/api/contract/status/${id}`);
      if (r.key) console.error("⚠ API key below is shown ONCE — store it now (e.g. in your keychain).");
      out(r);
      return 0;
    }
    case "list":
      out(await http("GET", "/api/contract/members", undefined, true));
      return 0;
    case "approve":
    case "reject":
    case "revoke": {
      if (!id) { console.error(`usage: contract ${cmd} <m_id>`); return 2; }
      out(await http("POST", `/api/contract/${id}/${cmd}`, {}, true));
      return 0;
    }
    case "pool": {
      const key = process.env.CONTRACT_API_KEY || "";
      if (!key) { console.error("set CONTRACT_API_KEY=olm_… (member key) for pool view"); return 2; }
      const res = await fetch(`${BASE}/api/pool/nodes`, { headers: { authorization: `Bearer ${key}` } });
      out(await res.json());
      return res.ok ? 0 : 1;
    }
    case "doctor": {
      const { runDoctor, renderDoctor } = await import("./doctor.ts");
      const result = await runDoctor(BASE, { adminToken: process.env.SAAS_ADMIN_TOKEN });
      console.log(renderDoctor(result));
      return result.ok ? 0 : 1;
    }
    case "shard": {
      const { detectShardCapability, planShardGroup } = await import("./shard.ts");
      const { execFileSync } = await import("node:child_process");
      const has = (bin: string) => { try { execFileSync("which", [bin], { stdio: "pipe" }); return true; } catch { return false; } };
      const rpcFlag = (() => { try { return execFileSync("llama-server", ["--help"], { stdio: "pipe" }).toString().includes("--rpc"); } catch { return false; } })();
      const cap = detectShardCapability({ "llama-server": has("llama-server"), "rpc-server": has("rpc-server"), rpcFlag });
      if (id === "plan") {
        const key = process.env.CONTRACT_API_KEY || "";
        if (!key) { console.error("set CONTRACT_API_KEY=olm_… for shard plan"); return 2; }
        const res = await fetch(`${BASE}/api/pool/nodes`, { headers: { authorization: `Bearer ${key}` } });
        const { nodes } = (await res.json()) as { nodes: Array<{ memberId: string; url?: string; ramGB: number; freshness: string; rpcPort?: number }> };
        const candidates = (nodes || []).filter((n) => n.freshness === "fresh" && n.url).map((n) => ({ memberId: n.memberId, url: n.url as string, ramGB: n.ramGB, rpcPort: (n as any).rpcPort }));
        try {
          out({ capability: cap, plan: planShardGroup(Number(process.env.SHARD_LAYERS || 32), candidates) });
        } catch (e: any) {
          out({ capability: cap, plan: null, reason: e.message });
        }
        return 0;
      }
      out(cap);
      if (!cap.capable) console.error(`shard NOT capable — missing: ${cap.missing.join(", ")}. ${cap.hint}`);
      return 0;
    }
    default:
      console.error("usage: contract document | apply --email X | status <id> | list | approve <id> | reject <id> | revoke <id> | pool | doctor | shard [plan]");
      return 2;
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() || "");
if (isDirectRun) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
