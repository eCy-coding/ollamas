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
const KEY_PATH = process.env.CONTRACT_KEY_PATH || join(homedir(), ".ollamas", "contract-key");

function homeDir(): string {
  return homedir();
}

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
    options: {
      email: { type: "string" }, json: { type: "boolean", default: false }, timeout: { type: "string" },
      port: { type: "string" }, host: { type: "string" }, device: { type: "string" }, "from-pool": { type: "boolean", default: false },
    },
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
    case "suspend":
    case "revoke": {
      if (!id) { console.error(`usage: contract ${cmd} <m_id>`); return 2; }
      out(await http("POST", `/api/contract/${id}/${cmd}`, {}, true));
      return 0;
    }
    case "join": {
      if (!values.email) { console.error("usage: contract join --email you@example.com [--timeout 600]"); return 2; }
      const { joinPool, specsFromOs } = await import("./agent.ts");
      const os = await import("node:os");
      const identity = loadOrCreateIdentity();
      console.error(`applying to ${BASE} … (T0 must run: contract approve <id>)`);
      const r = await joinPool({
        baseUrl: BASE,
        email: values.email,
        specs: specsFromOs({ totalmemBytes: os.totalmem(), loadavg1: os.loadavg()[0] ?? 0, cpuCount: os.cpus().length, platform: os.platform(), arch: os.arch() }),
        machinePubkey: identity.publicKeyHex,
        fetchFn: fetch,
        pollIntervalMs: 5000,
        timeoutMs: Number(values.timeout || 600) * 1000,
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      });
      const { writeFileSync: wf, mkdirSync: mk } = await import("node:fs");
      const { dirname: dn } = await import("node:path");
      mk(dn(KEY_PATH), { recursive: true });
      wf(KEY_PATH, r.key + "\n", { mode: 0o600 });
      console.error(`✓ member ${r.memberId} active; key saved to ${KEY_PATH} (0600)`);
      console.error("next: contract agent install   (0-manuel heartbeat daemon)");
      out({ memberId: r.memberId, keyPath: KEY_PATH });
      return 0;
    }
    case "agent": {
      const { collectHeartbeat, heartbeatOnce, installAgent, uninstallAgent, agentLoaded, AGENT_LABEL } = await import("./agent.ts");
      const os = await import("node:os");
      const { readFileSync: rf } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const cliPath = fileURLToPath(import.meta.url);
      const plan = {
        label: AGENT_LABEL,
        nodeBin: process.execPath,
        cliPath,
        args: ["agent", "run"],
        logPath: join(homeDir(), ".ollamas", "contract-agent.log"),
        workdir: join(homeDir(), ".ollamas"),
      };
      if (id === "install") { const r = installAgent(plan); console.error(r.reason); return r.ok ? 0 : 1; }
      if (id === "uninstall") { const r = uninstallAgent(AGENT_LABEL); console.error(r.reason); return r.ok ? 0 : 1; }
      if (id === "status") { out({ label: AGENT_LABEL, loaded: agentLoaded(AGENT_LABEL) }); return 0; }
      if (id === "run" || id === "once") {
        const key = rf(KEY_PATH, "utf8").trim();
        const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
        // F1: advertise rpcPort ONLY when a local rpc-server is actually reachable —
        // this is what lets the operator plan a shard group over real member nodes.
        const { probeRpcPort } = await import("./shard.ts");
        const beat = async () => {
          let rpcPort: number | undefined;
          const declared = Number(process.env.CONTRACT_RPC_PORT || 0);
          if (declared > 0 && (await probeRpcPort("127.0.0.1", declared, 500))) rpcPort = declared;
          const hb = await collectHeartbeat({
            osInfo: { totalmemBytes: os.totalmem(), loadavg1: os.loadavg()[0] ?? 0, cpuCount: os.cpus().length, platform: os.platform(), arch: os.arch() },
            fetchFn: fetch,
            ollamaUrl,
            rpcPort,
          });
          const r = await heartbeatOnce({ baseUrl: BASE, key, fetchFn: fetch, hb });
          console.error(`[agent] heartbeat → ${r.status}${rpcPort ? ` rpc:${rpcPort}` : ""} (${new Date().toISOString()})`);
          return r;
        };
        const first = await beat();
        if (id === "once") return first.ok ? 0 : 1;
        setInterval(() => { beat().catch((e) => console.error(`[agent] ${e.message}`)); }, 60_000);
        await new Promise(() => {}); // run forever (launchd KeepAlive owns the lifecycle)
      }
      console.error("usage: contract agent install|uninstall|status|run|once");
      return 2;
    }
    case "quota": {
      const { readFileSync: rf } = await import("node:fs");
      const key = process.env.CONTRACT_API_KEY || rf(KEY_PATH, "utf8").trim();
      const res = await fetch(`${BASE}/api/pool/quota`, { headers: { authorization: `Bearer ${key}` } });
      out(await res.json());
      return res.ok ? 0 : 1;
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
      const shard = await import("./shard.ts");
      const { detectShardCapability, buildHeadPlan, resolveShardBinary, resolveOllamaModelBlob,
              modelSizeGB, startProcess, stopProcess, probeRpcPort, listShardProcesses, shardDir, rpcServerArgs, shardServerArgs } = shard;
      type RpcEndpoint = { host: string; port: number };
      const { execFileSync, spawn } = await import("node:child_process");
      const { existsSync, openSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");

      const rpcBin = resolveShardBinary("rpc-server");
      const headBin = resolveShardBinary("llama-server");
      const has = (bin: string) => { try { execFileSync(bin.includes("/") ? "test" : "which", bin.includes("/") ? ["-x", bin] : [bin], { stdio: "pipe" }); return true; } catch { return false; } };
      const rpcFlag = (() => { try { return execFileSync(headBin, ["--help"], { stdio: "pipe" }).toString().includes("--rpc"); } catch { return false; } })();
      const cap = detectShardCapability({ "llama-server": has(headBin), "rpc-server": has(rpcBin), rpcFlag });

      const LOCAL_RPC_PORTS = [50052, 50053];
      const HEAD_PORT = Number(process.env.SHARD_HEAD_PORT || 8085);
      const HEAD_LAYERS = Number(process.env.SHARD_LAYERS || 32);
      const headJsonPath = join(shardDir(), "head.json");
      const exec = (bin: string, args: string[], logPath: string): number => {
        const fd = openSync(logPath, "w"); // fresh log per start — old crash lines poison evidence greps
        const child = spawn(bin, args, { detached: true, stdio: ["ignore", fd, fd] });
        child.unref();
        return child.pid as number;
      };
      // downAll kills EVERY tracked pid (head + local rpc-* + member-rpc-*) via the
      // pid-file registry — no longer limited to hardcoded ports (listShardProcesses wired).
      const downAll = () => {
        let n = 0;
        for (const name of listShardProcesses()) {
          if (stopProcess(name, { kill: (pid) => { try { process.kill(pid); } catch { /* dead */ } return true; } })) n++;
        }
        try { writeFileSync(headJsonPath, JSON.stringify({ up: false }) + "\n", { mode: 0o600 }); } catch {}
        return n;
      };
      const resolveModel = (modelArg?: string): string => {
        let modelPath = modelArg && existsSync(modelArg) ? modelArg : null;
        if (!modelPath && modelArg) modelPath = resolveOllamaModelBlob(modelArg);
        if (!modelPath) throw new Error("model not found — pass a GGUF path or an installed ollama model name");
        return modelPath;
      };
      // Spawn ONLY the head llama-server over the given rpc endpoints (members run
      // their own rpc-servers via `serve-rpc`). Returns the head URL once healthy.
      const spawnHead = async (endpoints: RpcEndpoint[], modelPath: string, meta: Record<string, unknown>): Promise<string> => {
        if (!cap.capable) throw new Error(`shard NOT capable — missing: ${cap.missing.join(", ")}. ${cap.hint}`);
        mkdirSync(shardDir(), { recursive: true });
        startProcess("head", headBin, shardServerArgs({
          modelPath,
          endpoints,
          port: HEAD_PORT,
          ctxSize: Number(process.env.SHARD_CTX || 2048),
          tensorSplit: process.env.SHARD_TS || endpoints.map(() => "1").join(","),
        }), { exec });
        const url = `http://127.0.0.1:${HEAD_PORT}`;
        writeFileSync(headJsonPath, JSON.stringify({ up: true, url, model: modelPath, endpoints: endpoints.map((e) => `${e.host}:${e.port}`), ...meta }, null, 2) + "\n", { mode: 0o600 });
        for (let i = 0; i < 120; i++) {
          try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }); if (r.ok) return url; } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
        downAll();
        throw new Error(`head did not become healthy (log: ${shardDir()}/head.log)`);
      };
      // Local single-machine path (vK7): spawn 2 local rpc-servers, then the head.
      const upLocal = async (modelArg?: string): Promise<string> => {
        const modelPath = resolveModel(modelArg);
        mkdirSync(shardDir(), { recursive: true });
        // Distinct devices: default selection can land on BLAS (aborts on RMS_NORM).
        const devices = (process.env.SHARD_DEVICES || "MTL0,MTL0").split(",");
        LOCAL_RPC_PORTS.forEach((p, i) => {
          startProcess(`rpc-${p}`, rpcBin, rpcServerArgs({ host: "127.0.0.1", port: p, device: devices[i % devices.length] }), { exec });
        });
        for (const p of LOCAL_RPC_PORTS) {
          let ok = false;
          for (let i = 0; i < 120 && !ok; i++) { ok = await probeRpcPort("127.0.0.1", p, 500); if (!ok) await new Promise((r) => setTimeout(r, 500)); }
          if (!ok) { downAll(); throw new Error(`rpc-server on ${p} did not come up (log: ${shardDir()}/rpc-${p}.log)`); }
        }
        return spawnHead(LOCAL_RPC_PORTS.map((p) => ({ host: "127.0.0.1", port: p })), modelPath, { source: "local", rpc: LOCAL_RPC_PORTS.map((p) => `127.0.0.1:${p}`) });
      };
      // F1: operator path — build a head over LIVE pool member endpoints.
      const upFromPool = async (modelArg?: string): Promise<string> => {
        const key = process.env.CONTRACT_API_KEY || "";
        if (!key) throw new Error("set CONTRACT_API_KEY=olm_… (a member key) to read the pool");
        const modelPath = resolveModel(modelArg);
        const res = await fetch(`${BASE}/api/pool/nodes`, { headers: { authorization: `Bearer ${key}` } });
        const { nodes } = (await res.json()) as { nodes: Array<{ memberId: string; url?: string; ramGB: number; freshness: string; rpcPort?: number }> };
        let plan;
        try {
          plan = buildHeadPlan(nodes || [], HEAD_LAYERS, modelSizeGB(modelPath));
        } catch (e: any) {
          throw new Error(`pool: ${e.message} — members must run: contract serve-rpc + contract agent run (CONTRACT_RPC_PORT set)`);
        }
        console.error(`launching head over ${plan.endpoints.length} pool node(s): ${plan.memberIds.join(", ")}`);
        return spawnHead(plan.endpoints, modelPath, { source: "pool", memberIds: plan.memberIds });
      };

      if (id === "up") {
        const fromPool = Boolean(values["from-pool"]);
        const model = positionals.find((p, i) => i >= 2 && !p.startsWith("--")) || process.env.SHARD_MODEL;
        const url = fromPool ? await upFromPool(model) : await upLocal(model);
        console.log(`shard head healthy at ${url}${fromPool ? " (from pool)" : ` (local rpc: ${LOCAL_RPC_PORTS.join(",")})`}`);
        return 0;
      }
      if (id === "down") { console.log(`stopped ${downAll()} shard process(es)`); return 0; }
      if (id === "status") {
        let head: any = null;
        try { head = JSON.parse(readFileSync(headJsonPath, "utf8")); } catch {}
        const probes: Record<string, boolean> = {};
        const eps: string[] = Array.isArray(head?.endpoints) ? head.endpoints : LOCAL_RPC_PORTS.map((p) => `127.0.0.1:${p}`);
        for (const ep of eps) { const [h, p] = ep.split(":"); probes[ep] = await probeRpcPort(h ?? "127.0.0.1", Number(p), 500); }
        out({ capability: cap, tracked: listShardProcesses(), probes, head });
        return 0;
      }
      if (id === "proof") {
        const url = await upLocal(positionals[2] || process.env.SHARD_MODEL);
        const RPC_PORTS = LOCAL_RPC_PORTS;
        try {
          // Evidence = BOTH rpc-server logs grow during the completion: layers are
          // genuinely computed in two separate processes over TCP RPC.
          const logSize = (p: number) => { try { return readFileSync(join(shardDir(), `rpc-${p}.log`), "utf8").length; } catch { return 0; } };
          const before = RPC_PORTS.map(logSize);
          const t0 = Date.now();
          const r = await fetch(`${url}/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content: "Reply with exactly: SHARD-OK /no_think" }], max_tokens: 64, temperature: 0 }),
            signal: AbortSignal.timeout(120_000),
          });
          const j = (await r.json()) as any;
          const msg = j?.choices?.[0]?.message ?? {};
          const content = String(msg.content || msg.reasoning_content || ""); // thinking models fill reasoning_content
          const growth = RPC_PORTS.map((p, i) => (logSize(p) - (before[i] ?? 0)));
          const splitProven = growth.every((g) => g > 0);
          out({ ok: r.ok && content.length > 0 && splitProven, content: content.slice(0, 120), latencyMs: Date.now() - t0, tokens: j?.usage?.completion_tokens, rpcLogGrowthBytes: Object.fromEntries(RPC_PORTS.map((p, i) => [p, growth[i]])), splitProven });
          return r.ok && content.length > 0 && splitProven ? 0 : 1;
        } finally {
          downAll();
        }
      }
      if (id === "plan") {
        const key = process.env.CONTRACT_API_KEY || "";
        if (!key) { console.error("set CONTRACT_API_KEY=olm_… for shard plan"); return 2; }
        const model = positionals.find((p, i) => i >= 2 && !p.startsWith("--"));
        const size = model ? modelSizeGB(resolveModel(model)) : 0;
        const res = await fetch(`${BASE}/api/pool/nodes`, { headers: { authorization: `Bearer ${key}` } });
        const { nodes } = (await res.json()) as { nodes: Array<{ memberId: string; url?: string; ramGB: number; freshness: string; rpcPort?: number }> };
        try {
          out({ capability: cap, modelSizeGB: size || undefined, plan: buildHeadPlan(nodes || [], HEAD_LAYERS, size) });
        } catch (e: any) {
          out({ capability: cap, plan: null, reason: e.message });
        }
        return 0;
      }
      out(cap);
      if (!cap.capable) console.error(`shard NOT capable — missing: ${cap.missing.join(", ")}. ${cap.hint}`);
      return 0;
    }
    case "serve-rpc": {
      // F3: member-side — bind an rpc-server on a mesh/private address so the
      // operator's head can reach it, then advertise the port via `agent run`.
      const shard = await import("./shard.ts");
      const { detectShardCapability, resolveShardBinary, startProcess, stopProcess, rpcServerArgs, shardDir } = shard;
      const { execFileSync, spawn } = await import("node:child_process");
      const { openSync, mkdirSync } = await import("node:fs");
      const rpcBin = resolveShardBinary("rpc-server");
      const headBin = resolveShardBinary("llama-server");
      const has = (bin: string) => { try { execFileSync(bin.includes("/") ? "test" : "which", bin.includes("/") ? ["-x", bin] : [bin], { stdio: "pipe" }); return true; } catch { return false; } };
      const rpcFlag = (() => { try { return execFileSync(headBin, ["--help"], { stdio: "pipe" }).toString().includes("--rpc"); } catch { return false; } })();
      const cap = detectShardCapability({ "llama-server": has(headBin), "rpc-server": has(rpcBin), rpcFlag });
      const port = Number(values.port || process.env.CONTRACT_RPC_PORT || 50052);
      const host = String(values.host || process.env.CONTRACT_RPC_HOST || "127.0.0.1");

      if (id === "stop") {
        const ok = stopProcess(`member-rpc-${port}`, { kill: (pid) => { try { process.kill(pid); } catch {} return true; } });
        console.error(ok ? `stopped member-rpc-${port}` : `no member-rpc-${port} running`);
        return 0;
      }
      if (!cap.capable) { console.error(`serve-rpc NOT capable — missing: ${cap.missing.join(", ")}. ${cap.hint}`); return 1; }
      const exec = (bin: string, args: string[], logPath: string): number => {
        const fd = openSync(logPath, "w");
        const child = spawn(bin, args, { detached: true, stdio: ["ignore", fd, fd] });
        child.unref();
        return child.pid as number;
      };
      mkdirSync(shardDir(), { recursive: true });
      // rpcServerArgs enforces isPrivateHost — a public bind is refused (RISK-K1).
      const args = rpcServerArgs({ host, port, device: values.device ? String(values.device) : undefined });
      const pid = startProcess(`member-rpc-${port}`, rpcBin, args, { exec });
      console.log(`rpc-server bound ${host}:${port} (pid ${pid}). Advertise it: CONTRACT_RPC_PORT=${port} contract agent run`);
      console.error("stop with: contract serve-rpc stop --port " + port);
      return 0;
    }
    default:
      console.error("usage: contract document | apply --email X | join --email X | status <id> | list | approve|reject|suspend|revoke <id> | pool | quota | agent <install|uninstall|status|run|once> | serve-rpc [--host H --port P --device D | stop] | doctor | shard [up [--from-pool] <model> | down | status | proof | plan]");
      return 2;
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() || "");
if (isDirectRun) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
