#!/usr/bin/env node
// contract CLI — applicant side (apply/status) + T0 admin side (approve/reject/revoke/list).
// Zero-dep: node fetch + node:util parseArgs. Admin commands need SAAS_ADMIN_TOKEN
// (same guard as /api/saas). Server default: http://127.0.0.1:3000 (OLLAMAS_URL).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, totalmem, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { generateIdentity, type Identity } from "./identity.ts";
import { resolveServerUrl } from "./node-config.ts";

// G6: server URL resolves env > persisted operator config > loopback → 0-manual operator runs.
const BASE = resolveServerUrl();
const IDENTITY_PATH = process.env.CONTRACT_IDENTITY_PATH || join(homedir(), ".ollamas", "contract-identity.json");
const KEY_PATH = process.env.CONTRACT_KEY_PATH || join(homedir(), ".ollamas", "contract-key");

function homeDir(): string {
  return homedir();
}

/** Invoke this same CLI as a subprocess (used by `offer` to compose serve-rpc +
 * agent installs). Inherits env so CONTRACT_RPC_PORT etc. propagate. */
async function runSelf(args: string[]): Promise<number> {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const self = fileURLToPath(import.meta.url);
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [self, ...args], { stdio: "inherit", env: process.env });
    c.on("exit", (code) => resolve(code ?? 1));
    c.on("error", () => resolve(1));
  });
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
      port: { type: "string" }, host: { type: "string" }, device: { type: "string" }, model: { type: "string" }, "from-pool": { type: "boolean", default: false },
      ttl: { type: "string" }, quota: { type: "string" }, iters: { type: "string" }, oneclick: { type: "boolean", default: false },
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
    case "resume":
    case "rotate":
    case "revoke": {
      if (!id) { console.error(`usage: contract ${cmd} <m_id>`); return 2; }
      const r = await http("POST", `/api/contract/${id}/${cmd}`, {}, true);
      out(r);
      if (cmd === "rotate") console.error(`rotated. fetch the NEW key once: contract status ${id}`);
      return 0;
    }
    case "audit": {
      const limit = id ? Number(id) : 100;
      out(await http("GET", `/api/contract/audit?limit=${limit}`, undefined, true));
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
      const { collectHeartbeat, heartbeatOnce, agentBeatLoop, installAgent, uninstallAgent, agentLoaded, AGENT_LABEL } = await import("./agent.ts");
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
        const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
        const { probeRpcPort } = await import("./shard.ts");
        const { backoffMs } = await import("./breaker.ts");
        // beat re-reads the key each call (G-F: a rebooted daemon reloads the
        // persisted 0600 key and re-authenticates) and advertises rpcPort only when
        // a local rpc-server is actually reachable (F1).
        const beat = async (key: string) => {
          let rpcPort: number | undefined;
          const declared = Number(process.env.CONTRACT_RPC_PORT || 0);
          if (declared > 0 && (await probeRpcPort("127.0.0.1", declared, 500))) rpcPort = declared;
          const hb = await collectHeartbeat({
            osInfo: { totalmemBytes: os.totalmem(), loadavg1: os.loadavg()[0] ?? 0, cpuCount: os.cpus().length, platform: os.platform(), arch: os.arch() },
            fetchFn: fetch,
            ollamaUrl,
            rpcPort,
          });
          return heartbeatOnce({ baseUrl: BASE, key, fetchFn: fetch, hb });
        };
        if (id === "once") {
          const r = await beat(rf(KEY_PATH, "utf8").trim());
          console.error(`[agent] heartbeat → ${r.status}`);
          return r.ok ? 0 : 1;
        }
        // G-B: resilient loop — exponential backoff on failure (no launchd spin-restart).
        await agentBeatLoop({
          readKey: () => rf(KEY_PATH, "utf8").trim(),
          beat,
          sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
          backoff: (attempt) => backoffMs(attempt, 5_000, 300_000),
          onBeat: (r) => console.error(`[agent] heartbeat → ${r.status} ${r.ok ? "ok" : `fail #${r.attempt} → backoff ${Math.round(r.waitMs / 1000)}s`} (${new Date().toISOString()})`),
        });
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
          throw new Error(`pool: ${e.message} — members must run: contract offer (or serve-rpc + agent run)`);
        }
        // vK14 preflight: probe each endpoint over the mesh before spawning the head —
        // an unreachable member would otherwise hang the head's model load.
        const { preflightEndpoints } = shard;
        const { reachable, dropped } = await preflightEndpoints(plan.endpoints, (h, p) => probeRpcPort(h, p, 1500));
        if (dropped.length) console.error(`preflight: dropped ${dropped.length} unreachable endpoint(s): ${dropped.map((e) => `${e.host}:${e.port}`).join(", ")}`);
        if (reachable.length === 0) {
          throw new Error("pool: no reachable rpc endpoints (check mesh connectivity + that members ran 'contract offer')");
        }
        // re-plan slices over ONLY the reachable members (keep memberIds aligned to endpoints)
        const reachableSet = new Set(reachable.map((e) => `${e.host}:${e.port}`));
        const liveNodes = (nodes || []).filter((n) => {
          try { return n.url && n.rpcPort && reachableSet.has(`${new URL(n.url).hostname}:${n.rpcPort}`); } catch { return false; }
        });
        const livePlan = buildHeadPlan(liveNodes, HEAD_LAYERS, modelSizeGB(modelPath));
        console.error(`launching head over ${livePlan.endpoints.length} reachable pool node(s): ${livePlan.memberIds.join(", ")}`);
        return spawnHead(livePlan.endpoints, modelPath, { source: "pool", memberIds: livePlan.memberIds });
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
      // F3 + vK14: member-side rpc-server. Ephemeral bind (default) OR a persistent
      // launchd daemon (install/run/status/uninstall) that survives reboot and
      // self-configures its mesh address from contract-node.json.
      const shard = await import("./shard.ts");
      const { detectShardCapability, resolveShardBinary, startProcess, stopProcess, probeRpcPort, rpcServerArgs, shardDir } = shard;
      const { installAgent, uninstallAgent, agentLoaded } = await import("./agent.ts");
      const { loadNodeConfig, saveNodeConfig } = await import("./node-config.ts");
      const { detectMeshHost } = await import("./mesh.ts");
      const { execFileSync, spawn } = await import("node:child_process");
      const { openSync, mkdirSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const rpcBin = resolveShardBinary("rpc-server");
      const headBin = resolveShardBinary("llama-server");
      const has = (bin: string) => { try { execFileSync(bin.includes("/") ? "test" : "which", bin.includes("/") ? ["-x", bin] : [bin], { stdio: "pipe" }); return true; } catch { return false; } };
      const rpcFlag = (() => { try { return execFileSync(headBin, ["--help"], { stdio: "pipe" }).toString().includes("--rpc"); } catch { return false; } })();
      const cap = detectShardCapability({ "llama-server": has(headBin), "rpc-server": has(rpcBin), rpcFlag });
      const RPC_LABEL = "com.ollamas.contract.rpc";
      const cfg = loadNodeConfig().config;
      const port = Number(values.port || process.env.CONTRACT_RPC_PORT || cfg.rpcPort);
      // host precedence: --host > node-config meshHost > live mesh detect > env > loopback
      const host = String(values.host || cfg.meshHost || detectMeshHost() || process.env.CONTRACT_RPC_HOST || "127.0.0.1");
      const device = values.device ? String(values.device) : cfg.device;

      if (id === "stop") {
        const ok = stopProcess(`member-rpc-${port}`, { kill: (pid) => { try { process.kill(pid); } catch {} return true; } });
        console.error(ok ? `stopped member-rpc-${port}` : `no member-rpc-${port} running`);
        return 0;
      }
      if (id === "install") {
        const plan = {
          label: RPC_LABEL, nodeBin: process.execPath, cliPath: fileURLToPath(import.meta.url),
          args: ["serve-rpc", "run"], logPath: join(homeDir(), ".ollamas", "contract-rpc.log"), workdir: join(homeDir(), ".ollamas"),
        };
        // persist chosen port/host/device so `run` self-configures on reboot
        saveNodeConfig({ ...cfg, rpcPort: port, meshHost: values.host || cfg.meshHost || detectMeshHost(), device });
        const r = installAgent(plan); console.error(r.reason); return r.ok ? 0 : 1;
      }
      if (id === "uninstall") { const r = uninstallAgent(RPC_LABEL); console.error(r.reason); return r.ok ? 0 : 1; }
      if (id === "status") {
        out({ label: RPC_LABEL, loaded: agentLoaded(RPC_LABEL), host, port, reachable: await probeRpcPort(host === "0.0.0.0" ? "127.0.0.1" : host, port, 800) });
        return 0;
      }
      if (!cap.capable) { console.error(`serve-rpc NOT capable — missing: ${cap.missing.join(", ")}. ${cap.hint}`); return 1; }
      // rpcServerArgs enforces isPrivateHost — a public bind is refused (RISK-K1).
      const args = rpcServerArgs({ host, port, device });
      mkdirSync(shardDir(), { recursive: true });

      if (id === "run") {
        // Foreground launchd target: spawn the rpc-server as a CHILD and stay alive
        // so launchd KeepAlive owns the lifecycle; if the child dies, exit → restart.
        const fd = openSync(join(shardDir(), `member-rpc-${port}.log`), "w");
        const child = spawn(rpcBin, args, { stdio: ["ignore", fd, fd] });
        console.error(`[serve-rpc] rpc-server bound ${host}:${port} (pid ${child.pid})`);
        await new Promise<void>((resolve) => { child.on("exit", (code) => { console.error(`[serve-rpc] rpc-server exited ${code}`); resolve(); }); });
        return 1; // non-zero → launchd KeepAlive restarts
      }

      // default: ephemeral detached bind (vK12 behavior, back-compat)
      const exec = (bin: string, a: string[], logPath: string): number => {
        const fd = openSync(logPath, "w");
        const c = spawn(bin, a, { detached: true, stdio: ["ignore", fd, fd] });
        c.unref();
        return c.pid as number;
      };
      const pid = startProcess(`member-rpc-${port}`, rpcBin, args, { exec });
      console.log(`rpc-server bound ${host}:${port} (pid ${pid}). Advertise it: CONTRACT_RPC_PORT=${port} contract agent run`);
      console.error("persist across reboot: contract serve-rpc install");
      return 0;
    }
    case "offer": {
      // vK14 capstone: one command → PERMANENT member compute contribution.
      // Persist node config (mesh host auto-detected) then install BOTH daemons
      // (rpc-server + heartbeat) so the machine rejoins the pool after any reboot.
      const { saveNodeConfig, loadNodeConfig } = await import("./node-config.ts");
      const { detectMeshHost } = await import("./mesh.ts");
      const cfg = loadNodeConfig().config;
      const port = Number(values.port || process.env.CONTRACT_RPC_PORT || cfg.rpcPort);
      if (id === "stop") {
        const rpc = await runSelf(["serve-rpc", "uninstall"]);
        const agent = await runSelf(["agent", "uninstall"]);
        console.error(`offer stopped (rpc:${rpc} agent:${agent})`);
        return 0;
      }
      const meshHost = detectMeshHost();
      saveNodeConfig({ ...cfg, rpcPort: port, role: "member", meshHost, model: values.model ? String(values.model) : cfg.model, device: values.device ? String(values.device) : cfg.device });
      console.error(`node config saved: meshHost=${meshHost ?? "(loopback — no mesh detected)"} rpcPort=${port}`);
      process.env.CONTRACT_RPC_PORT = String(port);
      const rpc = await runSelf(["serve-rpc", "install"]);
      const agent = await runSelf(["agent", "install"]);
      console.log(`offer active — this machine permanently contributes to the pool (rpc daemon:${rpc === 0 ? "ok" : "fail"}, heartbeat daemon:${agent === 0 ? "ok" : "fail"})`);
      console.error(meshHost ? `advertising ${meshHost}:${port} over the mesh` : "no mesh address detected — bring up tailscale/headscale, then: contract offer");
      return rpc === 0 && agent === 0 ? 0 : 1;
    }
    case "watch": {
      // vK16 G-B: monitor head + pool-member rpc liveness with a per-endpoint
      // breaker; report degradation (operator re-runs shard up --from-pool).
      // Auto-regroup is vK17 (needs a live shard). Ctrl-C to stop.
      const { probeRpcPort } = await import("./shard.ts");
      const { CircuitBreaker } = await import("./breaker.ts");
      const key = process.env.CONTRACT_API_KEY || "";
      const breakers = new Map<string, InstanceType<typeof CircuitBreaker>>();
      const once = async () => {
        const lines: string[] = [];
        if (key) {
          try {
            const res = await fetch(`${BASE}/api/pool/nodes`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2000) });
            const { nodes } = (await res.json()) as { nodes: Array<{ memberId: string; url?: string; rpcPort?: number; freshness: string }> };
            for (const n of (nodes || []).filter((x) => x.freshness === "fresh" && x.rpcPort && x.url)) {
              const host = new URL(n.url as string).hostname; const ep = `${host}:${n.rpcPort}`;
              if (!breakers.has(ep)) breakers.set(ep, new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }));
              const b = breakers.get(ep)!;
              const ok = await probeRpcPort(host, n.rpcPort as number, 1500);
              ok ? b.onSuccess() : b.onFailure();
              lines.push(`${ok ? "✓" : "✗"} ${n.memberId.slice(0, 8)} ${ep} [${b.state()}]${b.state() === "open" ? " — re-run: contract shard up --from-pool" : ""}`);
            }
          } catch (e: any) { lines.push(`pool/nodes error: ${e.message}`); }
        } else {
          lines.push("set CONTRACT_API_KEY to monitor member endpoints");
        }
        let head: any = null;
        try { head = JSON.parse((await import("node:fs")).readFileSync(join((await import("./shard.ts")).shardDir(), "head.json"), "utf8")); } catch {}
        lines.push(`head: ${head?.up ? `UP ${head.url}` : "down"}`);
        console.error(`[watch ${new Date().toISOString()}]\n  ${lines.join("\n  ")}`);
      };
      await once();
      if (id === "once") return 0;
      setInterval(() => { once().catch((e) => console.error(`[watch] ${e.message}`)); }, 15_000);
      await new Promise(() => {});
      return 0;
    }
    case "calibrate": {
      // vK18: measure pure paths + assert the 10 security/efficiency invariants,
      // write CALIBRATION.md, recommend data-driven constants. Exit≠0 on any
      // invariant failure (a regression guard for the working principles).
      const { runPureCalibration, assertInvariants } = await import("./calibrate.ts");
      const { renderTable, percentile } = await import("./bench.ts");
      const { writeFileSync: wf } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const iters = Number(values.iters) || 500;
      const cal = runPureCalibration({ iters });
      const inv = assertInvariants();
      const probeP99 = cal.rows.find((r) => r.label === "invite.verify")?.summary.p99 ?? 0;
      const table = renderTable(cal.rows);
      const lines: string[] = [];
      lines.push(`# Contract Lane Calibration`, "", `Pure-path microbench (${iters} iters each). Measured on this host — re-run to recalibrate.`, "", table, "");
      lines.push(`## Invariants (${inv.passed} passed, ${inv.failed.length} failed)`, "");
      lines.push(inv.failed.length === 0 ? "✓ all security + efficiency invariants hold." : inv.failed.map((f) => `✗ ${f.name}: ${f.detail}`).join("\n"), "");
      lines.push(`## Tuned constants`, "",
        "| constant | value | type | basis |",
        "|---|---|---|---|",
        `| PROBE_TIMEOUT_MS | 1500 | speed | mesh-safe; ceil(p99×margin) |`,
        `| backoff base/max | 5s/300s | speed | measured server recovery |`,
        `| breaker threshold/cooldown | 3/30s | policy | fault tolerance |`,
        `| invite TTL | 10m | POLICY (security) | RISK-K17 — NOT sped up |`,
        `| quota | 1000/day | POLICY (business) | fixed |`,
        `| heartbeat stale/dead | 3m/30m | POLICY (SLA) | fixed |`, "");
      const md = lines.join("\n") + "\n";
      const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "CALIBRATION.md");
      if (id !== "print") { try { wf(outPath, md); } catch {} }
      console.log(md);
      console.error(`invariants: ${inv.passed} passed, ${inv.failed.length} failed. (verify p99 ≈ ${percentile([probeP99], 99).toFixed(4)}ms)`);
      return inv.failed.length === 0 ? 0 : 1;
    }
    case "invite": {
      // vK17 (operator): mint a signed, single-use, short-TTL pre-approval token.
      // Minting IS the operator's consent → the device auto-activates, no manual approve.
      const { loadOrCreateOperatorKey } = await import("./opkey.ts");
      const { mintInvite } = await import("./invite.ts");
      const { saveNodeConfig, loadNodeConfig } = await import("./node-config.ts");
      const { randomBytes } = await import("node:crypto");
      if (id === "rotate") {
        const { rotateOperatorKey } = await import("./opkey.ts");
        const k = rotateOperatorKey();
        const cfg = loadNodeConfig().config;
        saveNodeConfig({ ...cfg, operatorPubkey: k.publicKeyHex, operatorEpoch: k.epoch });
        console.log(`operator key rotated → epoch ${k.epoch}. ALL outstanding invites are now invalid (kill switch).`);
        return 0;
      }
      const op = loadOrCreateOperatorKey();
      const cfg = loadNodeConfig().config;
      saveNodeConfig({ ...cfg, operatorPubkey: op.publicKeyHex, operatorEpoch: op.epoch });
      const ttlMin = Number(values.ttl || 10); // vK18 D: 10m default (RISK-K17 tighter; single-use+epoch already bound it)
      const now = Date.now();
      const doc = await http("GET", "/api/contract/document").catch(() => ({ hash: "" }));
      const oneClick = id === "oneclick" || Boolean(values["oneclick"]);
      // vK19 --oneclick: embed mesh creds (fresh headscale preauth key + login-server)
      // + operator pubkey so ONE artifact carries everything a fresh device needs.
      let headscaleUrl = "";
      let authkey = "";
      if (oneClick) {
        headscaleUrl = String(process.env.CONTRACT_HEADSCALE_URL || "");
        try {
          const { execFileSync } = await import("node:child_process");
          authkey = execFileSync("headscale", ["preauthkeys", "create", "--user", "ollamas", "--expiration", "1h"], { encoding: "utf8", timeout: 5000 }).trim().split("\n").pop()!.trim();
        } catch { authkey = ""; } // headscale not running → device joins the mesh manually
      }
      const token = mintInvite({
        v: 1, jti: randomBytes(8).toString("hex"), iat: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlMin * 60000).toISOString(),
        quotaReqPerDay: Number(values.quota || 1000),
        allowedModel: values.model ? String(values.model) : undefined,
        contractHash: String((doc as any).hash || ""),
        serverUrl: BASE, epoch: op.epoch,
        ...(oneClick ? { headscaleUrl: headscaleUrl || undefined, authkey: authkey || undefined, opPubHex: op.publicKeyHex } : {}),
      }, op.privateKeyPem);
      if (oneClick) {
        const meshIp = (await import("./mesh.ts")).detectMeshHost() || "127.0.0.1";
        const port = (() => { try { return new URL(BASE).port || "3000"; } catch { return "3000"; } })();
        console.log(`curl -fsSL "http://${meshIp}:${port}/api/contract/install.sh?t=${token}" | bash`);
        console.error(`↑ one-click installer (single paste). Operator: ensure the pool server is up (contract server install) and the CLI bundle is built (contract/scripts/build-cli.sh).${authkey ? "" : "\nNOTE: no headscale authkey minted — the device must join the mesh manually first."}`);
      } else {
        console.log(token);
        console.error(`invite minted (TTL ${ttlMin}m, single-use). On the 2nd device: contract bootstrap ${token.slice(0, 24)}…  (or use --oneclick for a paste-and-go installer)`);
      }
      return 0;
    }
    case "bootstrap": {
      // vK17 (device): ONE command — mesh-join + build + auto-approve + offer.
      const token = id || "";
      if (!token) { console.error("usage: contract bootstrap <invite-token>  (get it from the operator: contract invite)"); return 2; }
      const { runBootstrap, decodeInviteServerUrl } = await import("./bootstrap.ts");
      const os = await import("node:os");
      const { writeFileSync: wf, mkdirSync: mk, existsSync } = await import("node:fs");
      const { dirname: dn } = await import("node:path");
      const shard = await import("./shard.ts");
      const decoded = decodeInviteServerUrl(token);
      if (!decoded) { console.error("malformed invite token"); return 1; }
      const identity = loadOrCreateIdentity();
      const result = await runBootstrap({
        invite: token,
        steps: {
          // mesh-join: only when an authkey is provided (CONTRACT_TAILSCALE_AUTHKEY);
          // on the operator box or when already on the mesh, SKIP (don't disrupt).
          meshJoin: async () => {
            const authkey = process.env.CONTRACT_TAILSCALE_AUTHKEY;
            const loginServer = process.env.CONTRACT_HEADSCALE_URL;
            if (!authkey || !loginServer) return "SKIP (already on mesh, or set CONTRACT_TAILSCALE_AUTHKEY + CONTRACT_HEADSCALE_URL)";
            const { execFileSync } = await import("node:child_process");
            execFileSync("tailscale", ["up", "--login-server", loginServer, "--authkey", authkey, "--accept-routes"], { stdio: "pipe" });
            return `joined mesh via ${loginServer}`;
          },
          ensureRpc: async () => {
            const { execFileSync } = await import("node:child_process");
            const { fileURLToPath } = await import("node:url");
            const bin = shard.resolveShardBinary("rpc-server");
            let has = existsSync(bin);
            if (!has) { try { execFileSync("which", ["rpc-server"], { stdio: "pipe" }); has = true; } catch { has = false; } }
            if (has) return "rpc-server present";
            const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "build-llamacpp.sh");
            execFileSync("bash", [script], { stdio: "inherit" });
            return "built RPC llama.cpp";
          },
          applyWithInvite: async (serverUrl, tok, _model) => {
            const res = await fetch(`${serverUrl}/api/contract/apply-with-invite`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ invite: tok, email: values.email || `device-${identity.publicKeyHex.slice(0, 8)}@bootstrap.local`, machinePubkey: identity.publicKeyHex, specs: { ramGB: Math.round(os.totalmem() / 1024 ** 3), os: os.platform(), arch: os.arch() } }),
            });
            const j = (await res.json()) as { key?: string; error?: string };
            if (!res.ok || !j.key) throw new Error(`apply-with-invite → ${res.status}: ${j.error || "no key"}`);
            mk(dn(KEY_PATH), { recursive: true }); wf(KEY_PATH, j.key + "\n", { mode: 0o600 });
            return j.key;
          },
          offer: async (model) => {
            process.env.OLLAMAS_URL = decoded.serverUrl;
            return runSelf(["offer", ...(model ? ["--model", model] : [])]);
          },
        },
      });
      for (const s of result.steps) console.error(`  ${s.name}: ${s.detail}`);
      if (result.ok) console.log("bootstrap complete — this machine is now a permanent pool member (auto-approved via invite)");
      else console.error(`bootstrap failed: ${result.reason}`);
      return result.ok ? 0 : 1;
    }
    case "server": {
      // G1 (operator): launchd daemon for the ollamas POOL SERVER so the pool is
      // always up (survives reboot) — the #1 0-manual gap. Also persists operator
      // node-config (serverUrl) so subsequent commands need no OLLAMAS_URL env (G6).
      const { installAgent, uninstallAgent, agentLoaded } = await import("./agent.ts");
      const { saveNodeConfig, loadNodeConfig } = await import("./node-config.ts");
      const { fileURLToPath } = await import("node:url");
      const { existsSync } = await import("node:fs");
      const SERVER_LABEL = "com.ollamas.server";
      // contract/src/cli.ts → repo root is two dirs up from contract/
      const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
      const tsxBin = join(repo, "node_modules", ".bin", "tsx");
      if (id === "uninstall") { const r = uninstallAgent(SERVER_LABEL); console.error(r.reason); return r.ok ? 0 : 1; }
      if (id === "status") {
        let health = false;
        try { health = (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
        out({ label: SERVER_LABEL, loaded: agentLoaded(SERVER_LABEL), serverUrl: BASE, healthy: health });
        return 0;
      }
      // install (default). The launchd plist has no env block → the server runs on
      // its own default PORT (3000); serverUrl is persisted to match (a custom port
      // would need plist EnvironmentVariables — deferred, not silently half-wired).
      if (!existsSync(tsxBin)) { console.error(`tsx not found at ${tsxBin} — run npm install in ${repo}`); return 1; }
      const serverUrl = "http://127.0.0.1:3000";
      const cfg = loadNodeConfig().config;
      saveNodeConfig({ ...cfg, role: "operator", serverUrl });
      const plan = {
        label: SERVER_LABEL, nodeBin: tsxBin, cliPath: join(repo, "server.ts"),
        args: [] as string[], logPath: join(homeDir(), ".ollamas", "server.log"), workdir: repo,
      };
      const r = installAgent(plan);
      console.error(r.reason);
      console.log(r.ok ? `pool server daemon installed (${SERVER_LABEL}) → pool stays up across reboot; serverUrl=${serverUrl}` : "install failed");
      return r.ok ? 0 : 1;
    }
    default:
      console.error("usage: contract calibrate [--iters 500]  (measure principles + assert invariants) | invite [--oneclick] [--model M --ttl 10 --quota 1000 | rotate]  (operator: mint pre-approval / one-click installer) | bootstrap <token>  (device: one-command turnkey join) | server [install|uninstall|status]  (operator: pool always-up) | offer [--model M --port P | stop]  (member: permanent contribution) | watch [once]  (liveness monitor) | document | apply --email X | join --email X | status <id> | list | approve|reject|suspend|resume|rotate|revoke <id> | audit [limit] | pool | quota | agent <install|uninstall|status|run|once> | serve-rpc [run|install|uninstall|status|stop] | doctor | shard [up [--from-pool] <model>|down|status|proof|plan]");
      return 2;
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() || "");
if (isDirectRun) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
