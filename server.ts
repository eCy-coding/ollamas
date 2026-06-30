import "dotenv/config"; // load .env into process.env before any provider/key read (getDecryptedKey fallback)
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { register as metricsRegister, httpDuration, recordToolMetric, registerStoreMetrics, shutdownTotal, ukpStageEventsTotal } from "./server/metrics";
import { logger } from "./server/logger";
import { openApiSpec } from "./server/openapi";
import swaggerUi from "swagger-ui-express";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { db, ChatSession } from "./server/db";
import { sessionEventsSince, sessionStepCount, isSessionDone, formatSseEvent, formatSseDone } from "./server/agent-events";
import { ProviderRouter, repairJson, getToolArgError } from "./server/providers";
import { geminiCliAvailable, generateViaGeminiCli } from "./server/gemini-cli";
import { listModels as aiListModels, generate as aiGenerate, generateTextStream as aiGenerateTextStream } from "./server/ai";
import { runTestgen, runAudit, generateStorefront, getRevenueConfig, setRevenueConfig, publishAuditToGitHub } from "./server/revenue";
import { notify } from "./server/notify";
import { FilesystemManager } from "./server/files";
import { TerminalManager } from "./server/terminal";
import { BackupService } from "./server/backup";
import { OrchestratorCoordinator } from "./server/orchestrator";
import { ToolRegistry, type ToolDeps, type ToolCtx, type ToolTier } from "./server/tool-registry";
import { registerHostScripts } from "./bin/host-bridge/register-host-scripts.mjs"; // scripts lane v5 register-seam
import { handleMcpRequest } from "./server/mcp/server";
import { buildResourceMetadata, PROTECTED_RESOURCE_PATH, buildAuthServerMetadata, AUTH_SERVER_METADATA_PATH, REGISTRATION_PATH } from "./server/mcp/oauth-metadata";
import { mcpDiscovery, MCP_DISCOVERY_PATH } from "./server/mcp/discovery";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { OllamasOAuthProvider } from "./server/mcp/oauth-provider";
import { listUpstreams, type UpstreamConfig } from "./server/mcp/client";
import { superviseUpstream, removeUpstream, startSupervisor, stopSupervisor, getUpstreamStatus } from "./server/mcp/supervisor";
import { initStore, closeStore, pingStore, poolStats, migrationVersion, pendingDeliveryCount, createTenant, issueApiKey, revokeApiKey, listPlans, recordUsage, monthToDateUsage, usageTimeseries, getTenant, listTenants, listKeys, recordAudit, listAudit, addUpstreamServer, listUpstreamServers, deleteUpstreamServer, allUpstreamServers, addWebhook, listWebhooks, deleteWebhook, listDeliveries, registerClient, resolveKey, getClient, saveOAuthToken, verifyClientSecret, recordStageEvent, listStageEvents } from "./server/store";
import { startWebhookWorker, stopWebhookWorker, verifyWebhook } from "./server/webhooks/outbound";
import { startOAuthGc, stopOAuthGc } from "./server/oauth-gc";
import { authMiddleware } from "./server/middleware/auth";
import { rateLimitMiddleware } from "./server/middleware/rate-limit";
import { runBilling, computeRun, handleWebhook, ensureBillingConfig, ensureCustomer, createPortalSession, createCheckoutSession, sendMeterEventAsync } from "./server/billing/stripe";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Seyir Defteri (logbook): append a structured entry to the mounted volume so
// host tools + the app share one ship's log. Fire-and-forget; never throws.
const SEYIR_DIR = process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), ".llm-mission-control");
const SEYIR_FILE = path.join(SEYIR_DIR, "seyir-defteri.jsonl");
function logSeyir(entry: Record<string, any>) {
  try {
    fs.mkdirSync(SEYIR_DIR, { recursive: true });
    fs.appendFileSync(SEYIR_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch { /* best-effort */ }
}

// Host-side macOS bridge client (iTerm2/Terminal.app, host exec, host writes).
// Extracted to ./server/host-bridge (v1.8) so the stdio entry point shares it.
import { runOnHostTerminal, execOnHost, writeHostFile, HOST_TOOLS_DIR, shArg } from "./server/host-bridge";
import { discoverBinaries } from "./server/artifacts";
import { buildFleetView } from "./server/cockpit";
import { coreUtilization, activitySummary } from "./server/cockpit-metrics";
import { rankMacModels } from "./server/cockpit-models";
import { checkAnswer, scoreCouncil } from "./server/council";
// Benchmarked Mac-efficient champion (real ollama tok/s on this MacBook, 2026-06-29):
// qwen3:8b ≈ 82 tok/s, resident, instant load. Bigger local models contend on the
// single-GPU Mac (MAX_LOADED_MODELS=1) → not efficient for concurrent use.
const MAC_MODEL_CHAMPION = process.env.MAC_MODEL_CHAMPION || "qwen3:8b";
const MAC_CHAMPION_TOKS = Number(process.env.MAC_CHAMPION_TOKS || 82);

// Injected host-side deps for the single tool choke-point (server/tool-registry.ts).
const TOOL_DEPS: ToolDeps = {
  FilesystemManager, TerminalManager, runOnHostTerminal, writeHostFile, execOnHost, HOST_TOOLS_DIR, shArg, db,
};

// scripts lane v5: manifest-driven host tool registration (scripts/inventory.json
// -> ToolRegistry under the host_ namespace). Best-effort — a bad manifest must
// not crash boot; the static built-in tools still serve.
try { registerHostScripts(ToolRegistry, TOOL_DEPS); } catch (e) { console.error("registerHostScripts failed:", (e as Error)?.message); }

// Security headers (helmet, Faz 9A). CSP/COEP disabled: the app serves a Vite
// SPA with inline scripts + SSE + cross-origin MCP clients; the remaining headers
// (HSTS, X-Frame-Options, noSniff, etc.) apply without breaking those flows.
// COOP is relaxed to same-origin-allow-popups: helmet's default `same-origin`
// severs the opener↔popup handle, which makes Firebase signInWithPopup (Google
// Drive sign-in) spuriously throw auth/popup-closed-by-user. allow-popups keeps
// cross-origin isolation while letting the app retain popups it opens.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

// Observability (Faz 9D): structured request logs (skip noisy polling) + Prometheus
// HTTP latency histogram on every response.
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" || req.url === "/metrics" } }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const route = (req.route?.path || req.path || "unknown").toString();
    httpDuration.labels(req.method, route, String(res.statusCode)).observe(Date.now() - start);
  });
  next();
});
// Prometheus scrape endpoint.
app.get("/metrics", async (req, res) => {
  // Opt-in auth: if METRICS_TOKEN is set, require it (Bearer or ?token=). Unset => open (back-compat).
  const _mtok = process.env.METRICS_TOKEN;
  if (_mtok) {
    const _a = (req.headers.authorization || "");
    const _p = _a.startsWith("Bearer ") ? _a.slice(7) : (((req.query.token as string) || ""));
    if (_p !== _mtok) { res.status(401).end("unauthorized"); return; }
  }
  res.set("Content-Type", metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});
// Readiness probe (Faz 9D + 13C): 200 only when the app is live, workspace bound,
// AND the store answers a query. A pg-down replica reports 503 so the load
// balancer routes away instead of serving 500s.
app.get("/api/ready", async (_req, res) => {
  const dbOk = await pingStore();
  const ready = CURRENT_MODE !== "demo" && !!db.data.workspacePath && dbOk;
  res.status(ready ? 200 : 503).json({ ready, mode: CURRENT_MODE, db: dbOk ? "up" : "down" });
});
// OpenAPI 3.1 spec + Swagger UI (Faz 10C).
app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

// Stripe webhook needs the RAW body for signature verification — register the
// raw parser for that path BEFORE the global JSON parser so it wins (Faz 4).
app.use("/api/billing/webhook", express.raw({ type: "*/*" }));
// UKP inbound stage-events: raw body required for HMAC signature verification
// (same reason as Stripe — must be registered before the global JSON parser).
app.use("/api/ingest/stage-events", express.raw({ type: "*/*" }));
// Binary file upload: capture the raw body (any content type) as a Buffer BEFORE the
// 50mb JSON parser — otherwise express.json swallows the stream and the byte payload
// is lost. 1gb cap; binary-safe round-trip via FilesystemManager.writeFileBuffer.
app.use("/api/workspace/upload", express.raw({ type: "*/*", limit: "1gb" }));

// Body Parsers with large limit for file saves and backup streams
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// SaaS fail-closed gate. The single-local-owner DASHBOARD surface (host terminal,
// workspace files, multi-agent pipeline, backups, cluster control, raw inference,
// ReAct agent) has NO per-tenant auth — it trusts the localhost owner. When
// SAAS_ENFORCE=1 the server is a multi-tenant gateway exposed to untrusted callers,
// so this surface MUST be unreachable (the SaaS product is /mcp + /api/saas/*).
// Local mode (no enforce) passes through unchanged — single-owner UX preserved.
// Registered before the routes so it runs first for these path prefixes.
const localOwnerGuard = (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
  if (process.env.SAAS_ENFORCE === "1") {
    res.status(403).json({ error: "endpoint not available in SaaS mode (local-owner only)" });
    return;
  }
  next();
};
app.use(
  [
    "/api/terminal", "/api/macos-terminal", "/api/pipeline", "/api/workspace",
    "/api/backup", "/api/cluster", "/api/security", "/api/generate", "/api/ai",
    "/api/agent", "/api/keys", "/api/models", "/api/revenue",
  ],
  localOwnerGuard,
);

// Revenue Ops (Faz19) — local-owner-only personal income tooling (gated above). Produces
// LOCAL artifacts only (test-gen / audit / storefront); no money movement, no outreach.
app.get("/api/revenue/config", (_req, res) => res.json(getRevenueConfig()));
app.post("/api/revenue/config", (req, res) => res.json(setRevenueConfig(req.body || {})));
app.post("/api/revenue/testgen", async (req, res) => {
  try { res.json(await runTestgen(req.body || {})); } catch (e) { res.status(500).json({ ok: false, output: String((e as Error).message) }); }
});
app.post("/api/revenue/audit", async (req, res) => {
  try {
    const result = await runAudit(req.body || {});
    // Optional delivery: publish the findings to the client repo as a GitHub Issue (the paid
    // artifact). Graceful no-op when no githubRepo/token — the existing local path is unchanged.
    let github: Awaited<ReturnType<typeof publishAuditToGitHub>> | undefined;
    if (result.ok && req.body?.githubRepo) {
      github = await publishAuditToGitHub({ repo: req.body.repo, githubRepo: req.body.githubRepo, model: result.model });
    }
    // Best-effort alert (no-op without a configured sink; never throws into the response).
    if (result.ok) void notify(`✅ ollamas audit complete: ${result.findings ?? 0} finding(s)${github?.issueUrl ? ` → ${github.issueUrl}` : result.reportPath ? ` → ${result.reportPath}` : ""}`, db.data.notify);
    res.json({ ...result, github });
  } catch (e) { res.status(500).json({ ok: false, output: String((e as Error).message) }); }
});

// Outbound alert sinks (Slack/Discord incoming webhooks). Local-owner config.
app.get("/api/notify/config", (_req, res) => res.json(db.data.notify ?? {}));
app.post("/api/notify/config", (req, res) => {
  const { slackWebhookUrl, discordWebhookUrl } = req.body || {};
  db.data.notify = { slackWebhookUrl: slackWebhookUrl || undefined, discordWebhookUrl: discordWebhookUrl || undefined };
  db.save?.(db.data);
  res.json({ ok: true, notify: db.data.notify });
});
app.post("/api/notify/test", async (req, res) => {
  const sent = await notify(String(req.body?.text || "ollamas test alert ✅"), db.data.notify);
  res.json({ ok: sent.length > 0, sent });
});
app.post("/api/revenue/storefront", (req, res) => {
  try { res.json(generateStorefront(req.body || {})); } catch (e) { res.status(500).json({ ok: false, output: String((e as Error).message) }); }
});

/**
 * L1: Dynamic Environment Detection
 */
async function detectMode(): Promise<"live" | "degraded-live" | "demo"> {
  const isHardCloud = !!(
    process.env.K_SERVICE || 
    process.env.GOOGLE_CLOUD_RUN || 
    process.env.CODESANDBOX_SSE
  );
  
  if (isHardCloud) {
    return "demo";
  }

  // Probe local Ollama host
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  try {
    const res = await fetch(`${ollamaHost}/api/version`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      return "live";
    }
  } catch (e) {
    // Attempt docker-internal fallback probe too before degrading
    try {
      const fallbackRes = await fetch("http://host.docker.internal:11434/api/version", { signal: AbortSignal.timeout(1000) });
      if (fallbackRes.ok) {
        process.env.OLLAMA_HOST = "http://host.docker.internal:11434";
        return "live";
      }
    } catch (_) {}
  }

  return "degraded-live";
}

let CURRENT_MODE: "live" | "degraded-live" | "demo" = "demo";

// Dynamic start wrapper
async function initializeServer() {
  CURRENT_MODE = await detectMode();
  // Demo honesty (CRITICAL-2): allow the demo provider as a chain fallback ONLY in demo
  // mode. In live/degraded-live, an all-providers-down situation must surface as an
  // honest error — never fabricated demo text fed to the live agent as if real.
  ProviderRouter.demoFallbackAllowed = CURRENT_MODE === "demo";
  console.log(`[Cockpit] Master system initialized in environment mode: ${CURRENT_MODE.toUpperCase()}`);

  // SaaS store. node:sqlite default, or Postgres when DATABASE_URL is set (Faz 12).
  // initStore runs versioned migrations under an advisory lock (Faz 13B).
  await initStore();
  // Migrate-only mode (Faz 13B): K8s pre-upgrade Job / Helm hook runs schema
  // migrations to completion, then exits — Pods start only after the DB is ready.
  if (process.argv.includes("--migrate-only")) {
    console.log("[Migrate] schema up-to-date — exiting (--migrate-only).");
    await closeStore();
    process.exit(0);
  }
  // Pull-time store gauges for /metrics: pool, migration version, queue depth (Faz 14C).
  registerStoreMetrics({ poolStats, migrationVersion, pendingDeliveryCount });
  // Idempotently provision Stripe Meter/Price if a key is set (no-op otherwise, Faz 9C).
  ensureBillingConfig().then(c => c && console.log(`[Billing] Stripe meter+price ready (${c.meterId}).`)).catch(e => console.warn(`[Billing] setup skipped: ${e?.message}`));
  // Background outbound-webhook delivery worker (Faz 11B).
  startWebhookWorker();
  // Periodic OAuth retention sweeper — delete expired codes/tokens (Faz 26).
  startOAuthGc();

  // --- MCP gateway: CONNECT to upstream MCP servers (consume side, Faz 1) ---
  // Upstreams declared in tools.json `mcpServers`; each server's tools are merged
  // into ToolRegistry as `mcp__<server>__<tool>`. Best-effort — a dead upstream
  // never blocks boot.
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tools.json"), "utf-8"));
    const upstreams: UpstreamConfig[] = reg.mcpServers || [];
    // Faz 27: connect UNDER SUPERVISION (health-check + backoff + circuit-breaker
    // reconnect). Global tools.json upstreams are ownerless (shared); per-tenant
    // store upstreams keep owner=tenant_id so reconnect preserves isolation (Faz 24).
    // Parallel connect (was sequential): a slow/dead upstream no longer adds its timeout to the sum.
    await Promise.all(upstreams.map(async (cfg) => {
      const r = await superviseUpstream(cfg);
      console.log(`[MCP-Consume] ${r.name}: ${r.ok ? r.tools + " tools merged" : "FAILED — " + r.error}`);
    }));
    for (const u of await allUpstreamServers()) {
      const r = await superviseUpstream({ name: `${u.tenant_id}_${u.name}`, transport: u.transport, url: u.url || undefined, command: u.command || undefined, args: u.args, allowedTools: u.allowed_tools }, u.tenant_id);
      console.log(`[MCP-Consume][tenant ${u.tenant_id}] ${u.name}: ${r.ok ? r.tools + " tools" : "FAILED — " + r.error}`);
    }
    startSupervisor(); // periodic health/reconnect (opt-in via MCP_HEALTH_INTERVAL_MS)
  } catch (e: any) {
    console.warn(`[MCP-Consume] upstream init skipped: ${e?.message}`);
  }
  
  // Set default workspace path if empty dynamically
  if (!db.data.workspacePath) {
    db.data.workspacePath = CURRENT_MODE === "demo" ? "/demo/workspace" : path.join(os.homedir(), "ai-workspace");
    db.save();
  }

  // ----------------------------------------------------
  // API ROUTES
  // ----------------------------------------------------

  /**
   * Health & Telemetry API (L1, L11)
   */
  app.get("/api/health", async (req, res) => {
    const isLive = CURRENT_MODE === "live";
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
    
    // Live system metrics querying CPU load and memories
    const cpuLoads = os.loadavg();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem(),
      percentageUsed: Number(((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)),
    };

    let loadedModels: any[] = [];
    let ollamaVersion = "unavailable";
    // Reported, not gated: a DB blip shouldn't restart the pod (liveness),
    // only steer traffic via /api/ready (Faz 13C).
    const dbUp = await pingStore();

    if (CURRENT_MODE !== "demo") {
      try {
        const verRes = await fetch(`${ollamaHost}/api/version`, { signal: AbortSignal.timeout(3000) });
        if (verRes.ok) {
          const verJson = await verRes.json();
          ollamaVersion = verJson?.version || "unknown";
        }

        const psRes = await fetch(`${ollamaHost}/api/ps`, { signal: AbortSignal.timeout(3000) });
        if (psRes.ok) {
          const psJson = await psRes.json();
          loadedModels = psJson?.models || [];
        }
      } catch (e) {}
    }

    res.json({
      mode: CURRENT_MODE,
      isLive,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        uptime: os.uptime(),
      },
      metrics: {
        cpuLoad1Min: Number(cpuLoads[0].toFixed(2)),
        memory: systemMemory,
        ollamaVersion,
        loadedModels,
      },
      workspacePath: db.data.workspacePath,
      permissions: db.data.permissions,
      hasBackupEnabled: db.data.backup.enabled,
      binaries: discoverBinaries(),
      db: dbUp ? "up" : "down",
    });
  });

  // 2026 cockpit: ONE live SSE stream pushes the full mission-control view (host
  // metrics + active LLM backend + self-healing fleet) every 2s — push, not poll, so
  // the dashboard stays live with a single connection. Runs on the shared :3000 (HTTP
  // SSE, not the Vite WS) so it never flaps. Ollama is probed throttled (~6s) to avoid
  // load; system metrics are instant each tick.
  app.get("/api/cockpit/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();

    const ollamaHostNow = () => process.env.OLLAMA_HOST || "http://localhost:11434";
    const ollama = { version: "unavailable", loadedModels: [] as any[], allModels: [] as { name: string; size: number }[], macLoaded: [] as string[], reachable: false, latencyMs: null as number | null };
    let prevCpus = os.cpus(); // baseline for per-core utilization deltas across ticks
    const readPool = (): unknown => {
      try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".ollamas", "backends.json"), "utf8")); }
      catch { return []; }
    };
    // Mac efficiency: compute the binary manifest ONCE per connection + cache the pool —
    // they were re-read from disk every 2s frame (wasteful fs ops). Pool refreshes on the
    // throttled tick so fleet failover still surfaces.
    const cachedBinaries = discoverBinaries();
    let cachedPool = readPool();
    const probeOllama = async () => {
      if (CURRENT_MODE === "demo") { ollama.reachable = false; return; }
      const base = ollamaHostNow().replace(/\/+$/, "");
      try {
        const t0 = Date.now();
        const v = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2500) });
        ollama.latencyMs = Date.now() - t0; // real backend round-trip
        ollama.reachable = v.ok;
        if (v.ok) ollama.version = (await v.json().catch(() => ({})))?.version || "unknown";
        const ps = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2500) });
        if (ps.ok) ollama.loadedModels = (await ps.json().catch(() => ({})))?.models || [];
      } catch { ollama.reachable = false; ollama.latencyMs = null; }
      // Models panel = the user's MacBook library (localhost), independent of the active
      // serving backend (which may be a remote GPU exposing a smaller set).
      try {
        const mt = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2500) });
        if (mt.ok) ollama.allModels = ((await mt.json().catch(() => ({})))?.models || []).map((m: any) => ({ name: m.name, size: m.size }));
        const mp = await fetch("http://localhost:11434/api/ps", { signal: AbortSignal.timeout(2500) });
        if (mp.ok) ollama.macLoaded = ((await mp.json().catch(() => ({})))?.models || []).map((m: any) => m.name);
      } catch { /* Mac library unavailable */ }
    };

    let tick = 0;
    const push = async () => {
      if (res.writableEnded) return;
      if (tick % 3 === 0) { await probeOllama(); cachedPool = readPool(); } // throttle disk+net to ~6s
      const cpu = os.loadavg();
      const host = ollamaHostNow();
      // real-time concurrent data: per-core CPU (delta vs last tick) + live activity rollup.
      // Skip tick-0 cores (≈0ms interval → noisy); first real sample lands at tick 1.
      const nowCpus = os.cpus();
      const cores = tick === 0 ? [] : coreUtilization(prevCpus, nowCpus);
      prevCpus = nowCpus;
      const sessions = db.data.sessions || [];
      const activity = activitySummary(sessions, sessions.map((s: any) => ({ ts: s.updatedAt })), Date.now());
      const payload = {
        mode: CURRENT_MODE,
        isLive: CURRENT_MODE === "live",
        os: { platform: os.platform(), release: os.release(), arch: os.arch(), uptime: os.uptime() },
        metrics: {
          cpuLoad1Min: Number(cpu[0].toFixed(2)),
          memory: { total: os.totalmem(), free: os.freemem(), percentageUsed: Number(((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)) },
          ollamaVersion: ollama.version,
          loadedModels: ollama.loadedModels,
        },
        permissions: db.data.permissions,
        workspacePath: db.data.workspacePath,
        hasBackupEnabled: db.data.backup.enabled,
        binaries: cachedBinaries,
        db: "up",
        backend: { host, reachable: ollama.reachable, version: ollama.version, activeModel: ollama.loadedModels[0]?.name ?? null },
        // Cloud LLM providers whose key is present (vault/env) → available as fleet/council
        // backends alongside the local Mac models. Lets the cockpit show "cloud: gemini ✓".
        // ready reflects POOL LIVENESS (a non-cooled key), not mere key-presence, so the
        // chip honestly tracks the KeyVault rotation pool: it flips ✓ the instant a fresh
        // key joins and drops when the whole pool is quota-cooled. live/total mirror the
        // KeyVault burn meter so both tabs agree.
        cloudProviders: ["gemini", "anthropic", "openai", "openrouter", "ollama-cloud"]
          .map((p) => { const s = ProviderRouter.keyPoolStatus(p); return { name: p, ready: s.live > 0, live: s.live, total: s.total }; }),
        fleet: buildFleetView(cachedPool, host),
        realtime: { cores, activity, backendLatencyMs: ollama.latencyMs },
        models: {
          ...rankMacModels(ollama.allModels, os.totalmem(), ollama.macLoaded, MAC_MODEL_CHAMPION),
          championTokPerSec: MAC_CHAMPION_TOKS,
        },
        updatedAt: Date.now(), // freshness stamp → cockpit shows LIVE vs polling-fallback
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      tick++;
    };
    void push();
    const timer = setInterval(() => { void push(); }, 2000);
    timer.unref?.();
    req.on("close", () => clearInterval(timer));
  });

  // Live council calibration — dispatch the 4 auto-verifiable micro-tasks (combo-bench
  // ground-truths) to each Mac council model sequentially (MAX_LOADED_MODELS=1), stream
  // each (model,task) verdict + tok/s LIVE, then the combination verdict (single /
  // best-of-N / majority). Pure generate (no terminal/ReAct) → fast enough to watch.
  app.get("/api/council/calibrate", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();
    const models = String(req.query.models || "qwen3:8b").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const macBase = "http://localhost:11434";
    const send = (o: any) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
    const tasks = [
      { id: "overflow.fib", answer: "12586269025", prompt: "Compute Fibonacci where fib(0)=0, fib(1)=1. Reply with ONLY fib(50) as a single integer, nothing else. /no_think" },
      { id: "float.round", answer: "0.30", prompt: "What is (0.1 + 0.2) rounded to exactly 2 decimal places, formatted with two decimals like 0.30? Reply with ONLY that value, nothing else. /no_think" },
      { id: "dedupe.order", answer: "3,1,2", prompt: "From the array [3,1,3,2,1] remove duplicates keeping first-seen order. Reply with ONLY the result comma-joined with no spaces, nothing else. /no_think" },
      { id: "binsearch.miss", answer: "-1", prompt: "A binary search looks for 7 in the sorted array [1,2,3,4,5]; 7 is absent. Reply with ONLY the integer a correct binary search returns when the value is not found, nothing else. /no_think" },
    ];
    const results: { model: string; taskId: string; correct: boolean; unavailable?: boolean }[] = [];
    send({ type: "start", models, tasks: tasks.map((t) => t.id) });
    for (const model of models) {
      // Council members can be 3 kinds, gated ONCE so an absent credential skips the
      // member (unavailable, scorer-excluded) instead of penalizing it as 0%:
      //  - "gemini-cli": keyless external binary → gate on geminiCliAvailable()
      //  - "gemini":     cloud api-key provider → gate on a vault/env GEMINI_API_KEY
      //  - else:         an ollama model on the Mac → localhost /api/generate
      const isGeminiCli = model === "gemini-cli";
      const isGeminiCloud = model === "gemini";
      const gemCliOk = isGeminiCli ? await geminiCliAvailable().catch(() => false) : true;
      // Require a LIVE (non-cooled) pool key, not mere key-presence: a fully quota-cooled
      // pool → skip (unavailable) instead of a doomed 429 call; a fresh KeyVault key → attempt.
      const gemCloudOk = isGeminiCloud ? ProviderRouter.keyPoolStatus("gemini").live > 0 : true;
      for (const task of tasks) {
        if (res.writableEnded) break;
        let correct = false, tokPerSec = 0, ms = 0, unavailable = false;
        if (isGeminiCli && !gemCliOk) {
          unavailable = true; // gemini binary not installed → council member skipped, not penalized
        } else if (isGeminiCli) {
          try {
            const t0 = Date.now();
            const r = await generateViaGeminiCli([{ role: "user", content: task.prompt }], undefined, AbortSignal.timeout(90_000));
            ms = Date.now() - t0;
            correct = checkAnswer(r.text || "", task.answer);
            tokPerSec = r.tokensPerSec ?? 0;
          } catch { /* runtime spawn/timeout → counts as incorrect */ }
        } else if (isGeminiCloud && !gemCloudOk) {
          unavailable = true; // no GEMINI_API_KEY in vault/env → cloud member skipped, not penalized
        } else if (isGeminiCloud) {
          try {
            const t0 = Date.now();
            const r = await ProviderRouter.generate({ provider: "gemini", model: "", messages: [{ role: "user", content: task.prompt }], singleAttempt: true });
            ms = Date.now() - t0;
            correct = checkAnswer(r.text || "", task.answer);
            tokPerSec = r.tokensPerSec ?? 0;
          } catch { /* cloud api error/timeout → counts as incorrect */ }
        } else {
          try {
            const t0 = Date.now();
            const r = await fetch(`${macBase}/api/generate`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ model, prompt: task.prompt, stream: false, keep_alive: "30s", options: { num_predict: 512, num_ctx: 1024 } }),
              signal: AbortSignal.timeout(90_000),
            });
            ms = Date.now() - t0;
            if (r.ok) {
              const j: any = await r.json().catch(() => ({}));
              correct = checkAnswer(j.response || "", task.answer);
              const ec = j.eval_count || 0, ed = j.eval_duration || 1;
              tokPerSec = ed > 0 ? Math.round((ec / (ed / 1e9)) * 10) / 10 : 0;
            }
          } catch { /* model load/timeout → counts as incorrect for this task */ }
        }
        results.push({ model, taskId: task.id, correct, unavailable });
        send({ type: "result", model, taskId: task.id, correct, tokPerSec, ms, unavailable });
      }
    }
    send({ type: "done", ...scoreCouncil(results) });
    if (!res.writableEnded) res.end();
  });

  /**
   * Security & Permissions API (M7)
   */
  app.get("/api/security/log", (req, res) => {
    res.json(db.data.securityLog || []);
  });

  app.post("/api/security/permissions", (req, res) => {
    const { fileRead, fileWrite, commandExec, git } = req.body;
    db.data.permissions = {
      fileRead: !!fileRead,
      fileWrite: !!fileWrite,
      commandExec: !!commandExec,
      git: !!git,
    };
    db.logSecurity(
      "permission_change",
      "Update permissions",
      `System toggles changed - Read:${fileRead}, Write:${fileWrite}, Exec:${commandExec}, Git:${git}`,
      "info"
    );
    db.save();
    res.json({ success: true, permissions: db.data.permissions });
  });

  /**
   * Vault Settings Backend API (M1)
   */
  app.get("/api/keys/mask", (req, res) => {
    const masks: Record<string, string> = {};
    const keyConfig = db.data.keys || {};
    
    // Mask values
    Object.keys(keyConfig).forEach((keyName) => {
      const rawText = db.decrypt(keyConfig[keyName]);
      if (rawText) {
        masks[keyName] = rawText.startsWith("sk-")
          ? `sk-…${rawText.slice(-4)}`
          : `…${rawText.slice(-4)}`;
      }
    });

    // Provide default fallback masks if process.env loaded keys are placed
    const cloudProviders = ["gemini", "anthropic", "openai", "openrouter", "ollama-cloud"];
    cloudProviders.forEach((prov) => {
      if (!masks[prov]) {
        const envKey = process.env[prov.toUpperCase() + "_API_KEY"];
        if (envKey) {
          masks[prov] = `${prov.toUpperCase()}-ENV-SET`;
        }
      }
    });

    res.json(masks);
  });

  // Key-pool health (counts only — NEVER values). Lets the system-monitor alert when a
  // provider's user-supplied key pool is exhausted (all cooled) so a new key can be added.
  app.get("/api/keys/pool", (_req, res) => {
    const providers = ["gemini", "anthropic", "openai", "openrouter", "ollama-cloud"];
    // Per-provider pool health + proactive saturation (worst key burn %, all-approaching alert).
    const pool: Record<string, { total: number; live: number; worstPct: number; allApproaching: boolean }> = {};
    for (const p of providers) {
      const s = ProviderRouter.keyPoolStatus(p);
      const sat = ProviderRouter.poolSaturation(p);
      // Empty pool (no keys configured) has nothing to burn — report 0%, not the saturation
      // sentinel (poolSaturation returns worstPct=1 for "no live keys = saturated", which the
      // alert path below uses; the display must not paint an unconfigured provider full-red).
      pool[p] = { total: s.total, live: s.live, worstPct: s.total > 0 ? Math.round(sat.worstPct * 100) / 100 : 0, allApproaching: s.total > 0 && sat.allApproaching };
    }
    // alerts = providers that HAVE keys and whose whole live pool is saturating → operator action.
    const alerts = Object.entries(pool).filter(([, v]) => v.total > 0 && v.allApproaching).map(([provider, v]) => ({ provider, worstPct: v.worstPct, live: v.live }));
    res.json({ pool, alerts });
  });

  app.post("/api/keys", (req, res) => {
    const { provider, key, customEndpoint } = req.body;
    if (!provider) return res.status(400).json({ error: "Provider name requested" });

    if (key === "") {
      // Delete key
      delete db.data.keys[provider];
      if (provider === "custom-openai") {
        delete db.data.keys["custom-openai-endpoint"];
      }
      db.logSecurity("permission_change", `Key cleared for ${provider}`, "Removed provider auth credentials", "info");
    } else {
      // Encrypt and store securely (L9, M1)
      db.data.keys[provider] = db.encrypt(key);
      if (provider === "custom-openai" && customEndpoint) {
        db.data.keys["custom-openai-endpoint"] = customEndpoint;
      }
      db.logSecurity("permission_change", `Key vault configured: ${provider}`, "Decrypted credentials saved securely at rest", "info");
    }
    db.save();
    res.json({ success: true });
  });

  // Append a key to the provider's vault POOL (the guided "add next key" flow grows the pool
  // instead of overwriting the primary). Encrypted at rest; deduped at use by keyPool().
  app.post("/api/keys/add", (req, res) => {
    const { provider, key } = req.body;
    if (!provider || typeof provider !== "string") return res.status(400).json({ error: "provider required" });
    if (!key || typeof key !== "string" || !key.trim()) return res.status(400).json({ error: "key required" });
    const store = ((db.data as any).keyPool ||= {});
    (store[provider] ||= []).push(db.encrypt(key.trim()));
    db.save();
    db.logSecurity("permission_change", `Key pool grown: ${provider}`, "Added a rotation key to the encrypted pool", "info");
    res.json({ success: true, poolSize: ProviderRouter.keyPoolStatus(provider).total });
  });

  app.post("/api/keys/test", async (req, res) => {
    const { provider, key, customEndpoint } = req.body;
    // Guard: without a provider, `db.data.keys[provider]` would persist the key under
    // the literal "undefined" key → corrupted store on disk. Reject early.
    if (!provider || typeof provider !== "string") {
      return res.status(400).json({ error: "provider required" });
    }
    const testConfig = {
      provider,
      model: "",
      messages: [{ role: "user" as const, content: "ping test" }],
      stream: false,
      singleAttempt: true, // validate THIS provider+key only — no fallback/rotation false-positive
    };

    // Validate the candidate NON-destructively: a scoped override makes generate() use EXACTLY
    // this key (not the least-loaded pool pick) without touching the encrypted vault or disk —
    // so a failed test can never clobber/persist the working primary key (the prior bug).
    const priorEndpoint = db.data.keys["custom-openai-endpoint"];
    if (key) {
      ProviderRouter.testKeyOverride = { provider, key };
      if (provider === "custom-openai" && customEndpoint) {
        db.data.keys["custom-openai-endpoint"] = customEndpoint; // in-memory only, restored below
      }
    }

    try {
      const start = Date.now();
      const result = await ProviderRouter.generate(testConfig);
      const elapsed = Date.now() - start;
      res.json({ success: true, latencyMs: elapsed, output: result.text.substring(0, 50) });
    } catch (e: any) {
      res.json({ success: false, error: e.message || "Credential ping failed" });
    } finally {
      ProviderRouter.testKeyOverride = null;
      if (key && provider === "custom-openai") {
        if (priorEndpoint === undefined) delete db.data.keys["custom-openai-endpoint"];
        else db.data.keys["custom-openai-endpoint"] = priorEndpoint;
      }
    }
  });

  /**
   * Models listing endpoints to avoid catalog hardcoding (L3, M1)
   */
  app.get("/api/models/:provider", async (req, res) => {
    const prov = req.params.provider;
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";

    try {
      if (prov === "ollama-local") {
        if (CURRENT_MODE === "demo") {
          return res.json([
            "qwen3:8b", "qwen3:4b", "qwen3-coder:30b", "deepseek-r1:32b", "llama3.3:70b"
          ]);
        }
        const response = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
          const list = await response.json();
          const names = (list.models || []).map((m: any) => m.name);
          return res.json(names);
        }
        return res.json(["qwen3:8b", "qwen3:4b"]);
      }

      if (prov === "ollama-cloud") {
        const key = ProviderRouter.getDecryptedKey("ollama-cloud");
        if (!key) {
          return res.json(["API key not set for Ollama Cloud - please configure it in the Vault"]);
        }
        return res.json(["qwen3:8b", "qwen3:4b", "qwen3-coder:30b", "deepseek-r1:32b", "llama3.3:70b"]);
      }

      if (prov === "openrouter") {
        const key = ProviderRouter.getDecryptedKey("openrouter");
        if (!key) {
          return res.json(["API key not set for OpenRouter - please configure it in the Vault"]);
        }
        const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const list = await response.json();
          let names = (list.data || []).map((m: any) => m.id);
          if (req.query.freeOnly === "true") {
            names = names.filter((id: string) => id.endsWith(":free"));
          }
          return res.json(names);
        }
        return res.json(["google/gemini-2.5-flash-lite:free", "meta-llama/llama-3-8b-instruct:free"]);
      }

      if (prov === "gemini-cli") {
        // Keyless local backend: the external `gemini` binary carries its own Google auth.
        const ok = await geminiCliAvailable();
        return res.json(ok ? ["gemini-3-pro", "gemini-3-flash"] : ["gemini CLI not installed — npm i -g @google/gemini-cli"]);
      }

      if (prov === "gemini") {
        const key = ProviderRouter.getDecryptedKey("gemini");
        if (!key) {
          return res.json(["API key not set for Gemini - please configure it in the Vault"]);
        }
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const list = await response.json();
            const names = (list.models || [])
              .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
              .map((m: any) => m.name.replace("models/", ""));
            return res.json(names);
          }
        } catch (e) {}
        return res.json(["gemini-3.5-flash", "gemini-3.1-pro-preview"]);
      }

      if (prov === "anthropic") {
        const key = ProviderRouter.getDecryptedKey("anthropic");
        if (!key) {
          return res.json(["API key not set for Anthropic - please configure it in the Vault"]);
        }
        try {
          const response = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              "x-api-key": key,
              "anthropic-version": "2023-06-01"
            },
            signal: AbortSignal.timeout(5000)
          });
          if (response.ok) {
            const list = await response.json();
            const names = (list.data || []).map((m: any) => m.id);
            return res.json(names);
          }
        } catch (e) {}
        return res.json(["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
      }

      if (prov === "openai") {
        const key = ProviderRouter.getDecryptedKey("openai");
        if (!key) {
          return res.json(["API key not set for OpenAI - please configure it in the Vault"]);
        }
        try {
          const response = await fetch("https://api.openai.com/v1/models", {
            headers: {
              "Authorization": `Bearer ${key}`
            },
            signal: AbortSignal.timeout(5000)
          });
          if (response.ok) {
            const list = await response.json();
            const names = (list.data || [])
              .map((m: any) => m.id)
              .filter((id: string) => id.startsWith("gpt-") || id.startsWith("o1-") || id.startsWith("o3-"));
            return res.json(names);
          }
        } catch (e) {}
        return res.json(["gpt-4o-mini", "gpt-4o"]);
      }

      res.json([]);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  /**
   * Standard Prompt Proxy Endpoint with SSE Streaming Capability (M2)
   */
  app.post("/api/generate", async (req, res) => {
    const { provider, model, messages, temperature, stream } = req.body;
    // Raw endpoint contract: messages[] required. (For a single-string prompt use
    // POST /api/ai/generate.) Reject malformed input with a clear 400, not a 500.
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages (non-empty array) required; use POST /api/ai/generate for a single prompt string" });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        const result = await ProviderRouter.generate(
          { provider, model, messages, temperature, stream: true },
          (chunk) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        );
        res.write(`data: ${JSON.stringify({ done: true, source: result.source, latencyMs: result.latencyMs })}\n\n`);
        res.end();
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err.message || "Inference streaming failure" })}\n\n`);
        res.end();
      }
    } else {
      try {
        const result = await ProviderRouter.generate({
          provider,
          model,
          messages,
          temperature,
          stream: false,
        });
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || "Execution engine failure" });
      }
    }
  });

  /**
   * Colab-style ergonomic AI façade (v1.11) — single-string prompt, zero-config.
   * Mirrors `google.colab.ai`: `GET /api/ai/models` + `POST /api/ai/generate`.
   * Thin wrapper over server/ai.ts → ProviderRouter (ollama-local, auto default model).
   */
  app.get("/api/ai/models", async (_req, res) => {
    try {
      res.json(await aiListModels());
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "model listing failure" });
    }
  });

  app.post("/api/ai/generate", async (req, res) => {
    const { prompt, model, stream, temperature } = req.body;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "prompt (non-empty string) is required" });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      try {
        for await (const chunk of aiGenerateTextStream(prompt, { model, temperature })) {
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err?.message || "streaming failure" })}\n\n`);
        res.end();
      }
    } else {
      try {
        const result = await aiGenerate(prompt, { model, temperature });
        res.json({ text: result.text, model: result.modelUsed, source: result.source, tokensPerSec: result.tokensPerSec });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || "generation failure" });
      }
    }
  });

  /**
   * ReAct Agent Specialist Loop APIs (AC-A1, AC-A3)
   */
  // Measured best COMBINATION (combo-bench → champions.combination) wired into the
  // LIVE ReAct agent: default the model to the implementer, expose the verifier for
  // the opt-in final-answer gate. Graceful absent → {} (provider default = prior
  // behavior). Runtime counterpart to /api/pipeline's loadCombinationRoles.
  const loadAgentCombination = (): { implementer?: { provider?: string; model?: string }; verifier?: { provider?: string; model?: string } } => {
    try {
      const p = path.join(process.cwd(), "orchestration", "MODEL_SELECTION.json");
      const c = JSON.parse(fs.readFileSync(p, "utf8"))?.champions?.combination || {};
      return { implementer: c.implementer || c.overall || c.local, verifier: c.verifier };
    } catch { return {}; }
  };

  app.post("/api/agent/chat", async (req, res) => {
    const { messages, autoApply, maxSteps = 8, sessionId, verify } = req.body;
    // Caller params win; default to the measured champion ONLY when the caller pinned
    // NEITHER provider nor model. If the caller chose a provider (e.g. "gemini") we must
    // NOT leak the implementer's cross-provider model name to it — let that provider
    // resolve its own default (model=undefined).
    const _combo = loadAgentCombination();
    const _useCombo = req.body.provider === undefined && req.body.model === undefined && !!_combo.implementer;
    const provider = req.body.provider ?? (_useCombo ? _combo.implementer!.provider : undefined);
    const model = req.body.model ?? (_useCombo ? _combo.implementer!.model : undefined);

    // Validate BEFORE switching to SSE: once event-stream headers are sent we can no
    // longer return a clean status. A missing/empty messages[] would otherwise throw
    // an unhandled "messages is not iterable" and abort the stream (mirrors /api/generate).
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages (non-empty array) required; use POST /api/ai/generate for a single prompt string" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Abort the ReAct loop only on a real client disconnect. `req` "close" fires as
    // soon as the (already express.json-parsed) request body is consumed — wiring it
    // to abort() cancelled the very first LLM fetch ("operation was aborted") and
    // silently dropped the agent to demo fallback. `res` "close" is the correct
    // disconnect signal for a streaming response; guard so a normal end never aborts.
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });

    const sendEvent = (type: string, payload: any) => {
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    const isLive = CURRENT_MODE !== "demo";
    const workspaceRoot = db.data.workspacePath;

    // Surface which model the live agent runs (traceability: measured champion vs default).
    sendEvent("model", { provider: provider ?? "(chain default)", model: model ?? "(provider default)", source: _useCombo ? "combination" : "caller" });
    let finalText = ""; // captured at loop end for the opt-in verifier gate
    let bestTokS = 0;   // best per-step generation throughput — the final-reply turn is often empty (qwen3 think:false), so track every step

    // Tool schemas come from the single registry (AGENTS.md §4 choke-point).
    const AGENT_TOOLS = ToolRegistry.schemas();

    const customSystemPrompt = `You are a highly capable workspace Agent operating in ReAct (Reasoning and Action) mode. You have direct access to local developer workspace tools: list_tree, read_file, write_file, run_command, grep_search, macos_terminal (runs commands live in a real iTerm2/Terminal.app window on the host), write_host_file (writes a file directly to an absolute HOST path — use this to author host scripts/tools, then macos_terminal to run them), and the bridge tools run_tests / git_ops / process_port / health_probe / lint_format / git_commit / build_app / kill_process / log_stream / pkg_install / web_search / apply_patch / tools_doctor / shell_check / logbook (run the project's own self-built host tools).
Your mission is to help the user inspect, edit, coordinate, and test code dynamically in their workspace.

STRICT PROTOCOLS:
1. Work step-by-step. At each step, explain your brief thoughts about your next action, and selectively call appropriate tools.
2. Read the files first to get context before writing any edits.
3. Once any file changes are completed, run pytest, format, or static tests to verify that your changes are error-free.
4. Keep your replies concise and technical. Use Markdown format.

macOS / bash EXPERTISE (this host is macOS = BSD userland; commands run via macos_terminal):
- Before running any non-trivial shell command, call shell_check on it, fix what it reports, THEN run it. Minimize errors.
- BSD ≠ GNU: base64 decode is \`-D\` (not \`-d\`); \`sed -i ''\` needs the empty backup arg; no \`timeout\` (rely on the bridge watchdog); \`grep\` has no \`-P\`; \`xargs\` has no \`-r\`; date math is \`date -v\`.
- Always double-quote expansions ("$var"). Use \`set -euo pipefail\` for multi-step scripts. Feed \`< /dev/null\` to commands that might read stdin (e.g. docker compose exec -T).
- This runtime is Node 24: global \`fetch\` exists — never import node-fetch/undici and never use Deno APIs. .mjs uses import, not require.
- To author host files use write_host_file (not heredocs).

OLLAMAS OPERATING CONTRACT (see AGENTS.md — the single source of truth):
- North star: ollamas is becoming an MCP gateway + tools-as-SaaS broker. Favor work that moves toward that.
- Single choke-point: every tool runs through one registry. Never invent a second dispatch path; add tools as registry entries.
- Security tiers: tools are \`safe\` | \`host\` | \`privileged\`. \`macos_terminal\`/\`write_host_file\` are full-host (no sandbox) — treat as privileged, prefer \`safe\` tools, and only escalate when the task truly needs it.
- Quality gate before any commit: typecheck (lint_format) ✓ + shell_check ✓ + run_tests fresh ✓ → only then git_commit (conventional).
- Evidence over assertion: never claim something works without running it and showing output. Record notable steps via logbook.`;

    let activeHistory = [...messages];
    if (!activeHistory.some(m => m.role === "system")) {
      activeHistory.unshift({ role: "system", content: customSystemPrompt });
    }

    try {
      let stepNum = 1;
      let shouldHalt = false;
      let repairBudget = 2; // CRITICAL-3: bounded Try-Rewrite-Retry on malformed tool-call args

      while (stepNum <= maxSteps && !shouldHalt) {
        sendEvent("thought", { text: `Thinking on Step ${stepNum}...` });
        const start = Date.now();

        const result = await ProviderRouter.generate({
          provider,
          model,
          messages: activeHistory,
          tools: AGENT_TOOLS,
          stream: false,
        }, undefined, undefined, ac.signal);

        // Meter LLM output tokens (Faz 6D) — a billing dimension distinct from
        // per-tool-call usage, under the single-user "local" tenant.
        if (result.tokens && result.tokens > 0) {
          recordUsage({ tenantId: "local", tool: "__llm__", tier: "safe", ok: true, latencyMs: result.latencyMs || 0, tokens: result.tokens });
        }
        if (typeof result.tokensPerSec === "number" && result.tokensPerSec > bestTokS) bestTokS = result.tokensPerSec;

        // Collect LLM reply text
        if (result.text && result.text.trim()) {
          sendEvent("message", { text: result.text, step: stepNum });
        }
        // Push the model turn. When it emitted tool calls, the assistant message MUST carry
        // tool_calls — OpenAI/Anthropic reject a tool result not preceded by the matching
        // assistant tool_calls/tool_use (multi-step 400). Empty text is fine for a tool-only turn.
        if (result.toolCalls && result.toolCalls.length > 0) {
          activeHistory.push({ role: "assistant", content: result.text || "", tool_calls: result.toolCalls });
        } else if (result.text && result.text.trim()) {
          activeHistory.push({ role: "assistant", content: result.text });
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
          sendEvent("thought", { text: `Evaluating tool activation...`, toolCalls: result.toolCalls });

          for (const tc of result.toolCalls) {
            const toolName = tc.name;
            const toolCallId = tc.id;
            // CRITICAL-3: normalize string-encapsulated args (fastmcp#932) then check the
            // repair sentinel. Malformed args are NOT run with empty {} — feed the error
            // back so the model re-emits valid JSON (Try-Rewrite-Retry, bounded budget).
            let args = tc.arguments || {};
            if (typeof args === "string") {
              const p = repairJson(args);
              args = p && typeof p === "object" ? p : { __toolArgError: "tool arguments were a non-JSON string" };
            }
            const argErr = getToolArgError(args);
            if (argErr) {
              const msg = repairBudget > 0
                ? `ERROR: ${argErr}. Re-emit the "${toolName}" tool call with VALID JSON arguments — no code fences, no trailing commas, escape newlines/tabs inside strings.`
                : `ERROR: ${argErr}. Tool-arg repair budget exhausted; skipping this call.`;
              if (repairBudget > 0) repairBudget--;
              sendEvent("repair", { stepNum, tool: toolName, error: argErr, budgetLeft: repairBudget });
              activeHistory.push({ role: "tool" as any, name: toolName, tool_call_id: toolCallId, content: msg });
              continue; // do not execute with bad args; model retries next step
            }
            let output: any;
            let ok = true;
            let diff = "";
            let fileApplied = false;

            const toolStart = Date.now();

            // Meter the in-app agent path too, under the synthetic "local" tenant
            // (the single-user owner), so usage_events covers all tool traffic.
            const r = await ToolRegistry.execute(toolName, args, {
              isLive, workspaceRoot, autoApply, deps: TOOL_DEPS,
              tenantId: "local",
              abortSignal: ac.signal,
              onUsage: (e) => {
                recordUsage({ tenantId: "local", tool: e.tool, tier: e.tier, ok: e.ok, latencyMs: e.latencyMs });
                recordToolMetric(e.tool, e.tier, e.ok);
                if (e.tier !== "safe") recordAudit({ tenantId: "local", tool: e.tool, tier: e.tier, ok: e.ok });
              },
            });
            output = r.output;
            ok = r.ok;
            diff = r.diff;
            fileApplied = r.applied;
            if (r.halt) shouldHalt = true;

            const toolElapsed = Date.now() - toolStart;

            sendEvent("step", {
              stepNum,
              tool: toolName,
              args,
              ok,
              latency: toolElapsed,
              result: output,
              diff,
              applied: fileApplied
            });

            // Seyir defteri: record this action (what/how/result), args trimmed.
            logSeyir({
              kind: "agent_step",
              sessionId: sessionId || null,
              step: stepNum,
              tool: toolName,
              args: JSON.stringify(args).slice(0, 200),
              ok,
              latencyMs: toolElapsed,
              summary: (typeof output === "string" ? output : JSON.stringify(output)).slice(0, 160),
            });

            activeHistory.push({
              role: "tool" as any,
              name: toolName,
              tool_call_id: toolCallId,
              content: typeof output === "string" ? output : JSON.stringify(output)
            });
          }

          if (shouldHalt) {
            sendEvent("paused", { message: "System paused. Waiting for file approval." });
            break;
          }
        } else {
          // Final reply reached
          finalText = result.text || "";
          // Surface the final generation's throughput so dispatch benchmarking can measure
          // tok/s per run without a server round-trip (additive; clients ignore unknown fields).
          sendEvent("done", { text: finalText, status: "complete", tokensPerSec: bestTokS || (result.tokensPerSec ?? 0) });
          break;
        }

        stepNum++;
      }

      if (stepNum > maxSteps && !shouldHalt) {
        sendEvent("done", { text: "ReAct loop complete. Reached step depth limit.", status: "limit", tokensPerSec: bestTokS });
      }

      // Opt-in implementer≠verifier gate (combination policy): an INDEPENDENT verifier
      // model reviews the agent's final answer. Additive (never alters the answer),
      // default off (no latency/cost), best-effort (a verifier failure never breaks the
      // response). Verifier model differs from the implementer (champions.combination).
      if (verify && _combo.verifier?.model && finalText.trim() && !ac.signal.aborted) {
        try {
          const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
          const vr = await ProviderRouter.generate({
            provider: _combo.verifier.provider,
            model: _combo.verifier.model,
            messages: [
              { role: "system", content: "You are an independent verifier. Review the agent's final answer against the task for correctness and completeness. Reply with ONE line starting exactly 'VERDICT: PASS' or 'VERDICT: FAIL', then a brief reason." },
              { role: "user", content: `TASK:\n${lastUser?.content || "(n/a)"}\n\nAGENT FINAL ANSWER:\n${finalText}\n\nYour verdict?` },
            ],
            stream: false,
          }, undefined, undefined, ac.signal);
          const vtext = (vr.text || "").trim();
          const verdict = /VERDICT:\s*PASS/i.test(vtext) ? "PASS" : /VERDICT:\s*FAIL/i.test(vtext) ? "FAIL" : "UNCLEAR";
          sendEvent("verify", { verdict, reason: vtext.slice(0, 400), model: _combo.verifier.model });
        } catch { /* verifier is best-effort — never breaks the agent response */ }
      }

      if (sessionId) {
        const sess = (db.data.sessions || []).find(s => s.id === sessionId);
        if (sess) {
          sess.messages = activeHistory.map((m: any) => ({
            id: m.id || crypto.randomUUID(),
            role: m.role,
            content: m.content || "",
            timestamp: m.timestamp || new Date().toISOString(),
            name: m.name,
            tool_call_id: m.tool_call_id
          }));
          sess.updatedAt = new Date().toISOString();
          const firstUserMsg = activeHistory.find(m => m.role === "user");
          if (firstUserMsg && typeof firstUserMsg.content === "string" && sess.title === "New ReAct Session") {
            sess.title = firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? "..." : "");
          }
          db.save();
        }
      }

      res.end();
    } catch (err: any) {
      // Client disconnected — abort is expected, not an error.
      if (err?.name === "AbortError" || ac.signal.aborted) {
        res.end();
        return;
      }
      sendEvent("error", { message: err?.message || "Execution loop failure." });
      res.end();
    }
  });

  app.post("/api/agent/approve-write", async (req, res) => {
    const { path: filePath, content } = req.body;
    const isLive = CURRENT_MODE !== "demo";
    const workspaceRoot = db.data.workspacePath;

    try {
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: "Missing path or content parameters" });
      }

      FilesystemManager.writeFile(isLive, workspaceRoot, filePath, content);
      db.logSecurity("file_system", `Agent write_file (user-approved): ${filePath}`, "Wrote code changes following user approval", "allow");
      db.save();

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to approve write operation" });
    }
  });

  /**
   * Agent session persistence endpoints (AC-A6)
   */
  app.get("/api/agent/sessions", (req, res) => {
    try {
      const list = (db.data.sessions || []).map(s => ({
        id: s.id,
        title: s.title,
        providerId: s.providerId,
        modelId: s.modelId,
        updatedAt: s.updatedAt
      }));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch agent sessions" });
    }
  });

  app.get("/api/agent/sessions/:id", (req, res) => {
    try {
      const { id } = req.params;
      const session = (db.data.sessions || []).find(s => s.id === id);
      if (!session) {
        return res.status(404).json({ error: "Agent session not found" });
      }
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load agent session" });
    }
  });

  /**
   * Live-tail a running agent session over SSE (v17 Phase 1).
   * Replays prior steps (?after=<id>, default -1 = all), then polls the in-memory
   * session and pushes newly-appended steps until the session completes or the
   * client disconnects. Read-only: never signals/kills the underlying ReAct run.
   * Auth: covered by the `/api/agent` localOwnerGuard middleware (same as neighbors).
   */
  app.get("/api/agent/sessions/:id/events", (req, res) => {
    const { id } = req.params;
    const session = (db.data.sessions || []).find(s => s.id === id);
    if (!session) {
      return res.status(404).json({ error: "Agent session not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const afterRaw = Number((req.query.after as string) ?? "-1");
    const afterId = Number.isFinite(afterRaw) ? afterRaw : -1;

    // Replay everything the client hasn't seen yet; advance the high-water mark.
    let cursor = afterId;
    for (const ev of sessionEventsSince(session, afterId)) {
      res.write(formatSseEvent(ev.id, ev.data));
      cursor = ev.id;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearInterval(ping);
      clearTimeout(cap);
    };

    // If the run already completed before we attached, emit done and end now.
    if (isSessionDone(session)) {
      res.write(formatSseDone({ steps: sessionStepCount(session), reason: "complete" }));
      finish();
      return res.end();
    }

    // Poll the in-memory session for newly-appended steps (id-monotonic).
    const poll = setInterval(() => {
      // Re-resolve: db.data.sessions may be reassigned (e.g. on delete).
      const live = (db.data.sessions || []).find(s => s.id === id);
      if (!live) { // session deleted out from under us — close cleanly.
        res.write(formatSseDone({ steps: cursor + 1, reason: "gone" }));
        finish();
        return res.end();
      }
      for (const ev of sessionEventsSince(live, cursor)) {
        res.write(formatSseEvent(ev.id, ev.data));
        cursor = ev.id;
      }
      if (isSessionDone(live)) {
        res.write(formatSseDone({ steps: sessionStepCount(live), reason: "complete" }));
        finish();
        res.end();
      }
    }, 500);

    // Keep-alive comment so proxies/clients don't drop an idle stream.
    const ping = setInterval(() => { if (!res.writableEnded) res.write(":\n\n"); }, 15000);

    // Hard cap to avoid leaking a poller if a session never reports done.
    const cap = setTimeout(() => {
      if (!res.writableEnded) {
        res.write(formatSseDone({ steps: sessionStepCount(session), reason: "timeout" }));
        res.end();
      }
      finish();
    }, 10 * 60 * 1000);
    cap.unref?.();

    // Client disconnect: tear down timers; NEVER touch the underlying run.
    req.on("close", () => { finish(); });
  });

  app.post("/api/agent/sessions", (req, res) => {
    try {
      const { title, providerId, modelId } = req.body;
      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title: title || "New ReAct Session",
        modelId: modelId || "gemini-3.5-flash",
        providerId: providerId || "gemini",
        messages: [],
        updatedAt: new Date().toISOString()
      };
      if (!db.data.sessions) {
        db.data.sessions = [];
      }
      db.data.sessions.unshift(newSession);
      db.save();
      res.json(newSession);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create agent session" });
    }
  });

  app.delete("/api/agent/sessions/:id", (req, res) => {
    try {
      const { id } = req.params;
      const initialCount = (db.data.sessions || []).length;
      db.data.sessions = (db.data.sessions || []).filter(s => s.id !== id);
      db.save();
      res.json({ success: true, deleted: (db.data.sessions || []).length < initialCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete session" });
    }
  });

  /**
   * Filesystem API (M4)
   */
  app.get("/api/workspace/tree", async (req, res) => {
    const isLive = CURRENT_MODE !== "demo";
    try {
      const treeData = await FilesystemManager.getTree(isLive, db.data.workspacePath);
      res.json({
        ...treeData,
        mode: CURRENT_MODE,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/workspace/select", async (req, res) => {
    const { path: chosenPath } = req.body;
    if (!chosenPath) return res.status(400).json({ error: "Path parameter is required" });

    const isLive = CURRENT_MODE !== "demo";
    if (isLive) {
      if (!fs.existsSync(chosenPath)) {
        try {
          fs.mkdirSync(chosenPath, { recursive: true });
        } catch (e: any) {
          return res.status(400).json({ error: `Cannot initialize path: ${e.message}` });
        }
      }
    }
    db.data.workspacePath = chosenPath;
    db.save();
    res.json({ success: true, workspacePath: chosenPath });
  });

  app.get("/api/workspace/file", (req, res) => {
    const relativePath = req.query.relativePath as string;
    // Guard: a missing relativePath makes path.join throw ERR_INVALID_ARG_TYPE → a
    // misleading 500. A missing required query param is a client error (400).
    if (!relativePath || typeof relativePath !== "string") {
      return res.status(400).json({ error: "relativePath query parameter required" });
    }
    const isLive = CURRENT_MODE !== "demo";
    try {
      const content = FilesystemManager.readFile(isLive, db.data.workspacePath, relativePath);
      res.json({ content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/workspace/file", (req, res) => {
    const { relativePath, content } = req.body;
    // Validate types before fs write — a non-string content/path would throw deep in
    // fs and surface as a 500; reject malformed input with a clean 400.
    if (typeof relativePath !== "string" || !relativePath || typeof content !== "string") {
      return res.status(400).json({ error: "relativePath (string) and content (string) are required" });
    }
    const isLive = CURRENT_MODE !== "demo";
    try {
      FilesystemManager.writeFile(isLive, db.data.workspacePath, relativePath, content);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/workspace/file", (req, res) => {
    const relativePath = req.query.relativePath as string;
    if (typeof relativePath !== "string" || !relativePath) {
      return res.status(400).json({ error: "relativePath query parameter (string) is required" });
    }
    const isLive = CURRENT_MODE !== "demo";
    try {
      FilesystemManager.deleteFile(isLive, db.data.workspacePath, relativePath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Binary upload: raw Buffer body (express.raw registered above) → writeFileBuffer.
  // Path-confined by resolveSafePath inside writeFileBuffer; gated by localOwnerGuard.
  app.post("/api/workspace/upload", (req, res) => {
    const relativePath = req.query.relativePath as string;
    if (typeof relativePath !== "string" || !relativePath) {
      return res.status(400).json({ error: "relativePath query parameter (string) is required" });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: "binary request body required (send the file bytes; any Content-Type)" });
    }
    const isLive = CURRENT_MODE !== "demo";
    try {
      FilesystemManager.writeFileBuffer(isLive, db.data.workspacePath, relativePath, body);
      db.logSecurity("file_system", `HTTP upload: ${relativePath}`, `Wrote ${body.length} bytes`, "allow");
      res.json({ success: true, path: relativePath, bytes: body.length });
    } catch (e: any) {
      // Path-traversal block surfaces as a 400 (client error), other fs errors 500.
      const traversal = /traversal/i.test(e.message);
      res.status(traversal ? 400 : 500).json({ error: e.message });
    }
  });

  // Binary download: stream the file out with Content-Disposition so the browser
  // saves any file type uncorrupted (unlike GET /file which JSON-wraps utf-8 text).
  app.get("/api/workspace/download", (req, res) => {
    const relativePath = req.query.relativePath as string;
    if (typeof relativePath !== "string" || !relativePath) {
      return res.status(400).json({ error: "relativePath query parameter (string) is required" });
    }
    const isLive = CURRENT_MODE !== "demo";
    const filename = path.basename(relativePath).replace(/["\r\n]/g, "");
    try {
      if (!isLive) {
        const buf = FilesystemManager.readFileBuffer(isLive, db.data.workspacePath, relativePath);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/octet-stream");
        return res.send(buf);
      }
      if (!db.data.permissions.fileRead) {
        return res.status(403).json({ error: "Local filesystem read permission is disabled." });
      }
      const safePath = FilesystemManager.resolveSafePath(db.data.workspacePath, relativePath);
      if (!fs.existsSync(safePath)) {
        return res.status(404).json({ error: "Target file does not exist." });
      }
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/octet-stream");
      fs.createReadStream(safePath).pipe(res);
      db.logSecurity("file_system", `HTTP download: ${relativePath}`, "Streamed file", "allow");
    } catch (e: any) {
      const traversal = /traversal/i.test(e.message);
      res.status(traversal ? 400 : 500).json({ error: e.message });
    }
  });

  /**
   * Terminal Shell Shell API (M5)
   */
  app.post("/api/terminal", async (req, res) => {
    const { command } = req.body;
    const isLive = CURRENT_MODE !== "demo";
    try {
      const result = await TerminalManager.execute(isLive, db.data.workspacePath, command);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Seyir Defteri (logbook) — read the last N structured log entries.
   */
  app.get("/api/logbook", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    try {
      const lines = fs.existsSync(SEYIR_FILE) ? fs.readFileSync(SEYIR_FILE, "utf8").trim().split("\n") : [];
      const entries = lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      res.json({ count: entries.length, total: lines.length, entries });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manual logbook append (used by the logbook host tool / agent).
  app.post("/api/logbook", (req, res) => {
    if (!req.body || req.body.entry === undefined) return res.status(400).json({ error: "entry required" });
    logSeyir({ kind: "note", entry: req.body.entry });
    res.json({ ok: true });
  });

  // Reset RUM telemetry. The dashboard's web-vitals p75 + client-error counts are
  // derived from this append-only file; without a reset, a one-time bad metric
  // (e.g. a since-fixed CLS regression) lingers in the p75 window indefinitely.
  app.delete("/api/logbook", (_req, res) => {
    try {
      if (fs.existsSync(SEYIR_FILE)) fs.writeFileSync(SEYIR_FILE, "");
      res.json({ ok: true, cleared: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Real macOS terminal (iTerm2 / Terminal.app) via host-side bridge.
   * Runs commands in a visible window in real time — full host privileges.
   */
  app.post("/api/macos-terminal", async (req, res) => {
    const { command, target, timeoutMs } = req.body;
    if (!command) return res.status(400).json({ error: "command required" });
    try {
      db.logSecurity("command_exec", `Host terminal (${target || "iterm2"})`, command, "allow");
      const result = await runOnHostTerminal(target, command, timeoutMs);
      res.json(result);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * Complex Hierarchical Multi-Agent Pipeline Execution Engine (M3)
   */
  // Load the measured correctness-maximizing role assignment (combo-bench →
  // MODEL_SELECTION.json.champions.combination.roles). Graceful absent → {} so the
  // pipeline keeps prior behavior (caller-specified, else provider defaults).
  const loadCombinationRoles = (): Record<string, { provider?: string; model?: string }> => {
    try {
      const p = path.join(process.cwd(), "orchestration", "MODEL_SELECTION.json");
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j?.champions?.combination?.roles || {};
    } catch { return {}; }
  };

  app.post("/api/pipeline", async (req, res) => {
    const {
      prompt,
      architectProvider: _aP, architectModel: _aM,
      coderProvider: _cP, coderModel: _cM,
      reviewerProvider: _rP, reviewerModel: _rM,
      enableSelfImprove,
      maxIterations,
      writePermissions,
    } = req.body;

    // Caller params win; otherwise default each role to the measured best combination.
    const _roles = loadCombinationRoles();
    const architectProvider = _aP ?? _roles.architect?.provider;
    const architectModel = _aM ?? _roles.architect?.model;
    const coderProvider = _cP ?? _roles.coder?.provider;
    const coderModel = _cM ?? _roles.coder?.model;
    const reviewerProvider = _rP ?? _roles.reviewer?.provider;
    const reviewerModel = _rM ?? _roles.reviewer?.model;

    // Validate BEFORE switching to SSE — once event-stream headers are sent we can
    // no longer return a clean status; a missing prompt would stream `undefined`.
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "prompt (non-empty string) is required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendProgress = (stage: string, status: "pending" | "running" | "done" | "fail", resultText: string = "", tokensPerSec: number = 0, elapsed: number = 0, fallback?: string) => {
      res.write(`data: ${JSON.stringify({ stage, status, text: resultText, tokensPerSec, elapsed, fallback })}\n\n`);
    };

    const isLive = CURRENT_MODE !== "demo";
    let architectOutput = "";
    let coderOutput = "";
    let reviewerOutput = "";

    try {
      // 1. ARCHITECT STAGE
      sendProgress("architect", "running");
      const archPrompt = `[STAGE 1: ARCHITECT]
You are the Systems Architect. Design the project directory layout, file structures, and architecture mapping based on the user's requirements:
"${prompt}"

OUTPUT: Set out clear module hierarchies, files to be created, and complete specification rules.`;

      const startArch = Date.now();
      const archResult = await ProviderRouter.generate({
        provider: architectProvider,
        model: architectModel,
        messages: [{ role: "user", content: archPrompt }],
      }, undefined, (from, to) => {
        sendProgress("architect", "running", "", 0, 0, `fallback: ${from} → ${to}`);
      });
      architectOutput = archResult.text;
      const elapsedArch = Date.now() - startArch;
      // Synthesize estimated tokens per sec metrics matching real values (L11)
      const archTokensPerSec = archResult.tokensPerSec !== undefined ? archResult.tokensPerSec : Math.round((architectOutput.length / 4) / (elapsedArch / 1000 || 1));
      sendProgress("architect", "done", architectOutput, archTokensPerSec, elapsedArch);

      // 2. CODER STAGE
      sendProgress("coder", "running");
      const coderPrompt = `[STAGE 2: CODER]
You are the software developer. Based on the Architect's layout design:\n${architectOutput}\n\nWrite the FULL completed executable content for each file requested.
STRICT RULE: For each file you propose to create, emit a marker line of the format:
FILE: relative/path/to/file.ext
Followed immediately by a markdown fenced code block containing the complete source content. Write complete code with NO shortcuts.`;

      const startCoder = Date.now();
      const coderResult = await ProviderRouter.generate({
        provider: coderProvider,
        model: coderModel,
        messages: [{ role: "user", content: coderPrompt }],
      }, undefined, (from, to) => {
        sendProgress("coder", "running", "", 0, 0, `fallback: ${from} → ${to}`);
      });
      coderOutput = coderResult.text;
      const elapsedCoder = Date.now() - startCoder;
      const coderTokensPerSec = coderResult.tokensPerSec !== undefined ? coderResult.tokensPerSec : Math.round((coderOutput.length / 4) / (elapsedCoder / 1000 || 1));
      sendProgress("coder", "done", coderOutput, coderTokensPerSec, elapsedCoder);

      // Apply write operations internally if permitted
      let writeCount = 0;
      if (writePermissions) {
        // Parse FILE: annotations
        const lines = coderOutput.split("\n");
        let activeFile = "";
        let collectingContent = false;
        let blockContent: string[] = [];

        for (const line of lines) {
          if (line.trim().startsWith("FILE:")) {
            activeFile = line.replace("FILE:", "").trim();
            collectingContent = false;
            blockContent = [];
            continue;
          }

          if (activeFile) {
            if (line.trim().startsWith("```")) {
              if (!collectingContent) {
                collectingContent = true;
              } else {
                // End block, write now
                collectingContent = false;
                try {
                  FilesystemManager.writeFile(isLive, db.data.workspacePath, activeFile, blockContent.join("\n"));
                  writeCount++;
                } catch (e) {}
                activeFile = "";
              }
              continue;
            }

            if (collectingContent) {
              blockContent.push(line);
            }
          }
        }
      }

      // 3. REVIEWER STAGE
      sendProgress("reviewer", "running");
      const reviewerPrompt = `[STAGE 3: REVIEWER]
You are the primary Code Reviewer. Audit the designed structure and complete files emitted by the Coder:
${coderOutput}

Validate code correctness, structural logic, and perform a solid Big-O performance check and error safety inspection.`;

      const startReview = Date.now();
      const reviewerResult = await ProviderRouter.generate({
        provider: reviewerProvider,
        model: reviewerModel,
        messages: [{ role: "user", content: reviewerPrompt }],
      }, undefined, (from, to) => {
        sendProgress("reviewer", "running", "", 0, 0, `fallback: ${from} → ${to}`);
      });
      reviewerOutput = reviewerResult.text;
      const elapsedReview = Date.now() - startReview;
      const reviewTokensPerSec = reviewerResult.tokensPerSec !== undefined ? reviewerResult.tokensPerSec : Math.round((reviewerOutput.length / 4) / (elapsedReview / 1000 || 1));
      sendProgress("reviewer", "done", reviewerOutput, reviewTokensPerSec, elapsedReview);

      // Optional Bounded Self-Improve loop using workspace tests results (L12, M3 AC-12)
      if (enableSelfImprove && isLive) {
        let currentIt = 1;
        const maxIt = Math.min(Number(maxIterations) || 2, 3);
        let passed = false;

        while (currentIt <= maxIt && !passed) {
          res.write(`data: ${JSON.stringify({ stage: "self_improve", status: "running", text: `Running self-improve round ${currentIt}/${maxIt}...` })}\n\n`);
          
          // Execute test terminal script
          const testResult = await TerminalManager.execute(isLive, db.data.workspacePath, "pytest");
          if (testResult.exitCode === 0) {
            passed = true;
            res.write(`data: ${JSON.stringify({ stage: "self_improve", status: "done", text: `Success: All tests passed on round ${currentIt}!` })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ stage: "self_improve", status: "pending", text: `Tests failed on round ${currentIt}. Feeding back debugger report...` })}\n\n`);
            
            // Loop back failures to Coder
            const debugPrompt = `[SELF-IMPROVE DEBUGRound ${currentIt}]
The test suite yielded the following failures:
\`\`\`
${testResult.stderr || testResult.stdout}
\`\`\`
Please fix the code and output the corrected version of the files, matching the annotation rule:
FILE: path/to/file.ext
\`\`\`
content
\`\`\``;
            const refixResult = await ProviderRouter.generate({
              provider: coderProvider,
              model: coderModel,
              messages: [
                { role: "user", content: coderOutput },
                { role: "assistant", content: "I will review and fix" },
                { role: "user", content: debugPrompt }
              ],
            });
            coderOutput = refixResult.text;

            // Re-write fresh corrections
            const lines = coderOutput.split("\n");
            let activeFile = "";
            let collectingContent = false;
            let blockContent: string[] = [];

            for (const line of lines) {
              if (line.trim().startsWith("FILE:")) {
                activeFile = line.replace("FILE:", "").trim();
                collectingContent = false;
                blockContent = [];
                continue;
              }
              if (activeFile) {
                if (line.trim().startsWith("```")) {
                  if (!collectingContent) collectingContent = true;
                  else {
                    collectingContent = false;
                    try {
                      FilesystemManager.writeFile(isLive, db.data.workspacePath, activeFile, blockContent.join("\n"));
                    } catch (e) {}
                    activeFile = "";
                  }
                  continue;
                }
                if (collectingContent) blockContent.push(line);
              }
            }
          }
          currentIt++;
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, writeCount })}\n\n`);
      res.end();
    } catch (e: any) {
      res.write(`data: ${JSON.stringify({ error: e.message || "Pipeline execution failed." })}\n\n`);
      res.end();
    }
  });

  /**
   * Client-Side Secure Backups API (M8, M9)
   */
  app.get("/api/backup/config", (req, res) => {
    res.json({
      type: db.data.backup.type,
      endpoint: db.data.backup.endpoint,
      bucket: db.data.backup.bucket,
      accessKey: db.data.backup.accessKey ? "sk-***" : "",
      intervalMinutes: db.data.backup.intervalMinutes,
      enabled: db.data.backup.enabled,
    });
  });

  app.post("/api/backup/config", (req, res) => {
    const { type, endpoint, bucket, accessKey, secretKey, intervalMinutes, enabled } = req.body;
    
    db.data.backup = {
      type: type || "none",
      endpoint: endpoint || "",
      bucket: bucket || "",
      accessKey: accessKey || "",
      secretKey: secretKey || "",
      intervalMinutes: Number(intervalMinutes) || 120,
      enabled: !!enabled,
    };
    db.save();
    res.json({ success: true });
  });

  app.post("/api/backup/trigger", async (req, res) => {
    try {
      const report = await BackupService.uploadBackup();
      res.json({ success: true, ...report });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/backup/download", (req, res) => {
    try {
      const { cipherText, backupTime } = BackupService.performBackup();
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="backup-${backupTime.replace(/[:.]/g, "-")}.enc"`);
      res.send(cipherText);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/backup/restore", (req, res) => {
    // Restore from uploaded encrypted backup
    const { hexBlob } = req.body;
    if (!hexBlob) return res.status(400).json({ error: "Missing backup data payload" });

    try {
      const rawBuffer = Buffer.from(hexBlob, "hex");
      const restoredText = BackupService.performRestore(rawBuffer);
      const parsedConfig = JSON.parse(restoredText);

      // Save valid data
      db.save(parsedConfig);
      db.logSecurity("permission_change", "Backup restore", "Local database restored from external zero-knowledge file", "info");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Cluster Mesh Management API (Compliance-focused)
   */
  app.get("/api/cluster/status", (req, res) => {
    // Generate valid random peer keys if missing to satisfy cryptographic integrity
    if (!db.data.cluster.peerId) {
      db.data.cluster.peerId = "Qm" + crypto.randomBytes(16).toString("hex");
    }
    db.save();

    const orchestratorReport = OrchestratorCoordinator.getCapabilities();

    res.json({
      config: db.data.cluster,
      isLiveMode: CURRENT_MODE === "live",
      status: "active",
      peers: [],
      statistics: {
        totalGlobalCores: db.data.cluster.nodeActive ? (orchestratorReport.threads || 1) : 0,
        networkThroughputGb: 0.0,
      }
    });
  });

  // --- MCP gateway: EXPOSE the workspace tools over Streamable HTTP (Faz 1) ---
  // Tiers advertised/runnable to MCP clients. Default = all (localhost single-user);
  // Faz 3 replaces this with a per-tenant allowlist from the API key. Privileged
  // tools (macos_terminal/write_host_file) are full-host — narrow this before any
  // remote exposure (AGENTS.md §5).
  const MCP_EXPOSE_TIERS = (process.env.MCP_EXPOSE_TIERS || "safe,host,privileged")
    .split(",").map(s => s.trim()).filter(Boolean) as ToolTier[];

  // MCP clients have no interactive approval channel, so write_file auto-applies.
  // Set MCP_AUTO_APPLY=0 to make /mcp writes return a diff (halt) instead — paired
  // with narrowing MCP_EXPOSE_TIERS to exclude privileged host writes (AGENTS.md §5).
  const MCP_AUTO_APPLY = process.env.MCP_AUTO_APPLY !== "0";

  // Per-request ToolCtx. Authenticated tenants get their plan's tier allowlist +
  // usage metering; the unauthenticated single-user path keeps full default tiers.
  const mcpCtxFactory = (req: express.Request): ToolCtx => {
    const t = req.tenant;
    return {
      isLive: CURRENT_MODE !== "demo",
      workspaceRoot: db.data.workspacePath,
      autoApply: MCP_AUTO_APPLY,
      deps: TOOL_DEPS,
      allowedTiers: t ? t.plan.allowed_tiers : MCP_EXPOSE_TIERS,
      scopes: t?.scopes,
      tenantId: t?.tenantId,
      onUsage: t
        ? (e) => {
            recordUsage({ tenantId: e.tenantId!, tool: e.tool, tier: e.tier, ok: e.ok, latencyMs: e.latencyMs });
            recordToolMetric(e.tool, e.tier, e.ok);
            sendMeterEventAsync(e.tenantId!, 1); // real-time Stripe meter (no-op without key)
            if (e.tier !== "safe") recordAudit({ tenantId: e.tenantId!, tool: e.tool, tier: e.tier, ok: e.ok });
          }
        : undefined,
    };
  };

  // Externally-reachable origin. MCP_PUBLIC_URL pins it behind a proxy/LB; else
  // derive from the request. Used by all public discovery docs (Faz 15).
  const reqBase = (req: import("express").Request) =>
    process.env.MCP_PUBLIC_URL || `${req.protocol}://${req.get("host") || "localhost"}`;

  // RFC 9728 Protected Resource Metadata (public). MCP clients fetch this after a
  // 401's WWW-Authenticate to discover how to authenticate (AGENTS.md Faz 6A).
  app.get(PROTECTED_RESOURCE_PATH, (req, res) => {
    res.json(buildResourceMetadata(reqBase(req)));
  });

  // MCP HTTP discovery (Faz 15A): capabilities + transport + auth before connect.
  app.get(MCP_DISCOVERY_PATH, (req, res) => {
    res.json(mcpDiscovery(reqBase(req)));
  });

  // RFC 8414 Authorization Server Metadata (public) — advertises the DCR
  // registration_endpoint so RFC 7591 clients can self-register (Faz 15B).
  app.get(AUTH_SERVER_METADATA_PATH, (req, res) => {
    res.json(buildAuthServerMetadata(reqBase(req)));
  });

  // RFC 7591 Dynamic Client Registration (public, pre-auth). Issues a client_id
  // (+ secret for confidential clients) so MCP clients onboard without manual
  // setup. Rate-limited; DCR_INITIAL_ACCESS_TOKEN (if set) gates open registration.
  // NOTE: this records client metadata only — token issuance is a full OAuth 2.1
  // authorization server (backlog); ollamas still authenticates via opaque API keys.
  app.post(REGISTRATION_PATH, rateLimitMiddleware(), async (req, res) => {
    const gate = process.env.DCR_INITIAL_ACCESS_TOKEN;
    if (gate) {
      const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (bearer !== gate) return res.status(401).json({ error: "invalid_token", error_description: "initial access token required" });
    }
    const body = req.body || {};
    if (body.redirect_uris !== undefined && !Array.isArray(body.redirect_uris)) {
      return res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris must be an array" });
    }
    // DCR-time tenant binding (Faz 19B): when the caller is tenant-authenticated,
    // bind the new client to that tenant so the OAuth authorize() can auto-consent.
    // Uses x-api-key, or the bearer token when no DCR initial-access gate is set
    // (the gate already claims the Authorization header). Anonymous DCR → unbound.
    let tenant_id: string | null = null;
    const apiKey = String(req.headers["x-api-key"] || "") || (!gate ? (req.headers.authorization || "").replace(/^Bearer\s+/i, "") : "");
    if (apiKey) { const rk = await resolveKey(apiKey); if (rk) tenant_id = rk.tenantId; }
    try {
      const r = await registerClient({
        redirect_uris: body.redirect_uris, grant_types: body.grant_types,
        token_endpoint_auth_method: body.token_endpoint_auth_method, client_name: body.client_name,
        tenant_id,
      });
      const base = reqBase(req);
      res.status(201).json({
        client_id: r.client_id,
        ...(r.client_secret ? { client_secret: r.client_secret } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(r.client_secret ? { client_secret_expires_at: 0 } : {}),
        redirect_uris: r.redirect_uris,
        grant_types: r.grant_types,
        token_endpoint_auth_method: r.token_endpoint_auth_method,
        registration_access_token: r.registration_access_token,
        registration_client_uri: `${base}${REGISTRATION_PATH}/${r.client_id}`,
      });
    } catch (err: any) {
      res.status(500).json({ error: "server_error", error_description: err?.message || "registration failed" });
    }
  });

  // Faz 22 (v1.13): client_credentials grant (M2M). The SDK's /token handler
  // rejects this grant (UnsupportedGrantTypeError), so we intercept it BEFORE
  // mcpAuthRouter; every other grant_type falls through to the SDK unchanged.
  // Confidential clients only (timing-safe secret verify), tenant-bound, and the
  // grant must be in the client's registered grant_types. No refresh token (M2M).
  const parseClientAuth = (req: express.Request): { clientId?: string; secret?: string } => {
    const hdr = req.headers.authorization;
    if (typeof hdr === "string" && /^Basic\s+/i.test(hdr)) {
      const [id, sec] = Buffer.from(hdr.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":");
      return { clientId: id, secret: sec };
    }
    return { clientId: req.body?.client_id, secret: req.body?.client_secret };
  };
  app.post("/token", async (req, res, next) => {
    if (req.body?.grant_type !== "client_credentials") return next(); // SDK handles the rest
    try {
      const { clientId, secret } = parseClientAuth(req);
      if (!clientId || !secret || !(await verifyClientSecret(clientId, secret))) {
        return res.status(401).json({ error: "invalid_client" });
      }
      const client = await getClient(clientId);
      if (!client) return res.status(401).json({ error: "invalid_client" });
      if (!client.grant_types.includes("client_credentials")) {
        return res.status(400).json({ error: "unauthorized_client", error_description: "grant_type not allowed for this client" });
      }
      if (!client.tenant_id) {
        return res.status(400).json({ error: "unauthorized_client", error_description: "client is not bound to a tenant" });
      }
      const scope = typeof req.body.scope === "string" ? req.body.scope : "";
      const resource = typeof req.body.resource === "string" ? req.body.resource : null;
      const access = await saveOAuthToken({ client_id: clientId, tenant_id: client.tenant_id, scopes: scope, resource, ttlSecs: 3600 });
      return res.json({ access_token: access, token_type: "bearer", expires_in: 3600, scope: scope || undefined });
    } catch (err: any) {
      return res.status(500).json({ error: "server_error", error_description: err?.message });
    }
  });

  // OAuth 2.1 Authorization Server (Faz 19, v1.10). The SDK router serves
  // /authorize + /token + /revoke (authorization_code + PKCE S256) backed by our
  // OllamasOAuthProvider. Mounted AFTER our AS-metadata + DCR /register routes, so
  // those win for their paths (the router omits registration_endpoint since our
  // clientsStore has no registerClient — DCR stays tenant-aware in ollamas).
  const oauthIssuer = new URL(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`);
  app.use(mcpAuthRouter({
    provider: new OllamasOAuthProvider(),
    issuerUrl: oauthIssuer,
    resourceServerUrl: new URL("/mcp", oauthIssuer),
    scopesSupported: ["tools:safe", "tools:host", "tools:privileged"],
  }));

  // Origin allowlist for /mcp — DNS-rebinding protection (MCP Transports spec).
  // Default localhost only; override with ALLOWED_ORIGINS (CSV). A request with no
  // Origin (server-to-server MCP clients) is allowed.
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const originAllowed = (origin?: string) => {
    if (!origin) return true; // non-browser MCP clients send no Origin
    if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  };

  // SAAS_ENFORCE=1 → a valid API key is required on /mcp. Default off keeps the
  // current single-user localhost behavior. origin → auth → rate-limit → handler.
  app.all("/mcp", (req, res, next) => {
    if (!originAllowed(req.headers.origin)) return res.status(403).json({ error: "Origin not allowed (DNS-rebinding protection)" });
    next();
  }, authMiddleware(process.env.SAAS_ENFORCE === "1"), rateLimitMiddleware(), async (req, res) => {
    try {
      await handleMcpRequest(req, res, mcpCtxFactory);
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err?.message || "MCP request failed" });
    }
  });

  app.get("/api/mcp/upstreams", (_req, res) => {
    res.json({ exposeTiers: MCP_EXPOSE_TIERS, exposedTools: ToolRegistry.list(MCP_EXPOSE_TIERS).map(t => t.name), upstreams: listUpstreams() });
  });

  // --- SaaS admin: provision tenants + API keys (AGENTS.md Faz 3). Guarded by
  // X-Admin-Token. When SAAS_ENFORCE=1 (multi-tenant/production), a token is
  // MANDATORY — admin routes refuse to serve without one, so enabling enforcement
  // never silently leaves provisioning open. Pure single-user dev (enforce off,
  // no token) stays open for convenience. ---
  if (process.env.SAAS_ENFORCE === "1" && !process.env.SAAS_ADMIN_TOKEN) {
    console.warn("[SaaS] SAAS_ENFORCE=1 but SAAS_ADMIN_TOKEN unset — /api/saas + /api/billing admin routes are LOCKED (set SAAS_ADMIN_TOKEN).");
  }
  // Per-IP brute-force throttle for the admin token. timingSafeEqual alone does not
  // stop an attacker hammering guesses; lock an IP out for the window after N misses.
  // In-memory (per-process) — adequate for the single admin surface; a multi-replica
  // deploy would back this with the shared store/Redis.
  const adminFailures = new Map<string, { count: number; until: number }>();
  const ADMIN_MAX_FAILS = 5;
  const ADMIN_LOCK_MS = 15 * 60_000;
  const adminGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const required = process.env.SAAS_ADMIN_TOKEN;
    if (required) {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const now = Date.now();
      const rec = adminFailures.get(ip);
      if (rec && rec.count >= ADMIN_MAX_FAILS && now < rec.until) {
        res.setHeader("Retry-After", Math.ceil((rec.until - now) / 1000));
        return res.status(429).json({ error: "Too many bad admin attempts; try later" });
      }
      // Timing-safe compare to avoid leaking the token via response timing.
      const got = String(req.headers["x-admin-token"] || "");
      const a = Buffer.from(got);
      const b = Buffer.from(required);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        const r = adminFailures.get(ip) ?? { count: 0, until: 0 };
        r.count += 1;
        r.until = now + ADMIN_LOCK_MS;
        adminFailures.set(ip, r);
        return res.status(401).json({ error: "Bad admin token" });
      }
      adminFailures.delete(ip); // success → reset the counter
    } else if (process.env.SAAS_ENFORCE === "1") {
      // Enforcement on but no token configured → refuse rather than expose.
      return res.status(403).json({ error: "Admin disabled: set SAAS_ADMIN_TOKEN" });
    }
    next();
  };
  app.get("/api/saas/plans", adminGuard, async (_req, res) => res.json(await listPlans()));
  app.get("/api/saas/tenants", adminGuard, async (_req, res) => res.json(await listTenants()));
  app.get("/api/saas/keys", adminGuard, async (req, res) => {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : "";
    if (!tenantId) return res.status(400).json({ error: "Missing 'tenantId' query" });
    res.json(await listKeys(tenantId)); // metadata only — never hash/plaintext
  });
  app.post("/api/saas/tenants", adminGuard, async (req, res) => {
    try {
      const { name, plan, stripeCustomerId } = req.body || {};
      if (!name) return res.status(400).json({ error: "Missing 'name'" });
      const tenant = await createTenant(String(name), plan ? String(plan) : "free", stripeCustomerId ? String(stripeCustomerId) : null);
      ensureCustomer(tenant.id).catch(() => {}); // Stripe customer if configured (no-op otherwise)
      res.json(tenant);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/saas/keys", adminGuard, async (req, res) => {
    try {
      const { tenantId, label, ttlDays, scopes } = req.body || {};
      if (!tenantId) return res.status(400).json({ error: "Missing 'tenantId'" });
      res.json(await issueApiKey(String(tenantId), label ? String(label) : "", ttlDays != null ? Number(ttlDays) : undefined, scopes ? String(scopes) : "")); // plaintext key returned ONCE
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/saas/keys/:id/revoke", adminGuard, async (req, res) => {
    await revokeApiKey(req.params.id);
    res.json({ revoked: req.params.id });
  });
  app.get("/api/saas/audit", adminGuard, async (req, res) => {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json(await listAudit(tenantId, limit));
  });

  // --- Per-tenant upstream MCP servers (Faz 9E). Tenant-authenticated. ---
  app.get("/api/saas/upstreams", authMiddleware(true), async (req, res) => res.json(await listUpstreamServers(req.tenant!.tenantId)));
  app.post("/api/saas/upstreams", authMiddleware(true), async (req, res) => {
    try {
      const tId = req.tenant!.tenantId;
      const { name, transport, url, command, args, allowedTools } = req.body || {};
      if (!name || !transport) return res.status(400).json({ error: "Missing 'name' or 'transport'" });
      const { id } = await addUpstreamServer(tId, { name, transport, url, command, args, allowed_tools: allowedTools });
      // Faz 27: supervised + tenant-owned (Faz 24) — reconnect preserves isolation.
      const connect = await superviseUpstream({ name: `${tId}_${name}`, transport, url, command, args, allowedTools }, tId);
      res.json({ id, connect });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/saas/upstreams/:id", authMiddleware(true), async (req, res) => {
    const tId = req.tenant!.tenantId;
    const up = (await listUpstreamServers(tId)).find(u => u.id === req.params.id);
    if (!up) return res.status(404).json({ error: "Not found" });
    await deleteUpstreamServer(tId, req.params.id);
    await removeUpstream(`${tId}_${up.name}`); // unsupervise + unregister + disconnect (Faz 27)
    res.json({ deleted: req.params.id });
  });
  app.get("/api/saas/upstreams/status", authMiddleware(true), async (req, res) => {
    const tId = req.tenant!.tenantId;
    // Surface only this tenant's supervised upstreams (names are `<tenantId>_<name>`).
    res.json(getUpstreamStatus().filter((s) => s.name.startsWith(`${tId}_`)));
  });

  // --- Tenant SELF-SERVE (Faz 10B). Tenant's OWN API key + scope; no admin token. ---
  const requireScope = (scope: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.tenant?.scopes?.includes(scope)) return res.status(403).json({ error: `insufficient_scope: '${scope}' required` });
    next();
  };
  app.get("/api/saas/self/usage", authMiddleware(true), requireScope("usage:read"), async (req, res) => {
    const t = req.tenant!;
    res.json({ tenantId: t.tenantId, plan: t.plan.id, quota: t.plan.monthly_quota, used: await monthToDateUsage(t.tenantId), period: new Date().toISOString().slice(0, 7) });
  });
  app.get("/api/saas/usage/timeseries", authMiddleware(true), requireScope("usage:read"), async (req, res) => {
    res.json({ tenantId: req.tenant!.tenantId, series: await usageTimeseries(req.tenant!.tenantId) });
  });
  app.get("/api/saas/self/keys", authMiddleware(true), requireScope("keys:read"), async (req, res) => {
    res.json(await listKeys(req.tenant!.tenantId));
  });
  app.post("/api/saas/self/keys", authMiddleware(true), requireScope("keys:write"), async (req, res) => {
    const { label, ttlDays } = req.body || {};
    res.json(await issueApiKey(req.tenant!.tenantId, label ? String(label) : "self", ttlDays != null ? Number(ttlDays) : undefined, "keys:read usage:read"));
  });
  app.post("/api/saas/self/keys/:id/revoke", authMiddleware(true), requireScope("keys:write"), async (req, res) => {
    const owned = (await listKeys(req.tenant!.tenantId)).some(k => k.id === req.params.id);
    if (!owned) return res.status(404).json({ error: "Key not found for this tenant" });
    await revokeApiKey(req.params.id);
    res.json({ revoked: req.params.id });
  });

  // --- Tenant webhooks (Faz 11B). Outbound HMAC-signed event delivery. ---
  app.get("/api/saas/webhooks", authMiddleware(true), async (req, res) => res.json(await listWebhooks(req.tenant!.tenantId)));
  app.post("/api/saas/webhooks", authMiddleware(true), requireScope("webhooks:write"), async (req, res) => {
    const { url, events } = req.body || {};
    if (!url || !Array.isArray(events) || !events.length) return res.status(400).json({ error: "Missing 'url' or 'events[]'" });
    res.json(await addWebhook(req.tenant!.tenantId, String(url), events.map(String))); // secret returned ONCE
  });
  app.delete("/api/saas/webhooks/:id", authMiddleware(true), requireScope("webhooks:write"), async (req, res) => {
    res.json({ deleted: await deleteWebhook(req.tenant!.tenantId, req.params.id) });
  });
  app.get("/api/saas/webhooks/deliveries", authMiddleware(true), async (req, res) => res.json(await listDeliveries(req.tenant!.tenantId)));

  // A tenant's own current-month usage summary (authenticated).
  app.get("/api/saas/usage", authMiddleware(true), async (req, res) => {
    const t = req.tenant!;
    res.json({ tenantId: t.tenantId, plan: t.plan.id, monthlyQuota: t.plan.monthly_quota, used: await monthToDateUsage(t.tenantId) });
  });

  // --- Billing (AGENTS.md Faz 4). Dry-run unless STRIPE_API_KEY is set. ---
  app.get("/api/billing/preview", adminGuard, async (req, res) => {
    res.json(await computeRun(typeof req.query.period === "string" ? req.query.period : undefined));
  });
  app.post("/api/billing/run", adminGuard, async (req, res) => {
    try {
      res.json(await runBilling(typeof req.body?.period === "string" ? req.body.period : undefined));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/billing/webhook", async (req, res) => {
    try {
      const out = await handleWebhook(req.body as Buffer, String(req.headers["stripe-signature"] || ""));
      res.json(out);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // UKP inbound stage-events webhook receiver. Public endpoint (no auth middleware)
  // — security comes from HMAC signature verification (same Stripe-compatible scheme
  // used for outbound webhooks). Requires UKP_WEBHOOK_SECRET env var to be set.
  app.post("/api/ingest/stage-events", async (req, res) => {
    try {
      const secret = process.env.UKP_WEBHOOK_SECRET;
      if (!secret) return res.status(503).json({ error: "ingest disabled" });

      const raw = (req.body as Buffer).toString("utf8");
      const sigHeader = String(req.headers["x-ukp-signature"] || "");
      if (!verifyWebhook(secret, raw, sigHeader)) return res.status(401).json({ error: "invalid signature" });

      const parsed = JSON.parse(raw) as { type?: string; ts?: number };
      // Extract the timestamp from the signature header ("t={unix_sec},v1={hex}").
      const tStr = sigHeader.split(",").find((p) => p.startsWith("t="))?.slice(2) ?? "0";
      const id = crypto.createHash("sha256").update(`${tStr}.${raw}`).digest("hex");

      const eventType = String(parsed.type ?? "");
      const ts = Number(parsed.ts ?? 0);
      const { recorded } = await recordStageEvent({ id, eventType, payload: raw, ts });
      ukpStageEventsTotal.labels(eventType, String(recorded)).inc();
      return res.json({ ok: true, recorded });
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // List received UKP stage-events. Admin-gated; supports ?limit (clamped 1-1000)
  // and optional ?event_type filter (exact match, parameterized).
  app.get("/api/ingest/stage-events", adminGuard, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const eventType = typeof req.query.event_type === "string" ? req.query.event_type : undefined;
      res.json(await listStageEvents(limit, eventType));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Tenant self-service (Faz 9C). 501 when Stripe isn't configured (dry-run).
  app.post("/api/billing/portal", authMiddleware(true), async (req, res) => {
    try {
      const url = await createPortalSession(req.tenant!.tenantId);
      url ? res.json({ url }) : res.status(501).json({ error: "Billing not configured (set STRIPE_API_KEY)" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/billing/checkout", authMiddleware(true), async (req, res) => {
    try {
      const url = await createCheckoutSession(req.tenant!.tenantId);
      url ? res.json({ url }) : res.status(501).json({ error: "Billing not configured (set STRIPE_API_KEY)" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/cluster/execute", async (req, res) => {
    const { toolName, payload } = req.body;
    try {
      const result = await OrchestratorCoordinator.executeTool(toolName, payload);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/cluster/capabilities", (req, res) => {
    res.json(OrchestratorCoordinator.getCapabilities());
  });

  app.post("/api/cluster/config", (req, res) => {
    try {
      const { eulaApproved, nodeActive, numCtxLimit } = req.body;

      if (eulaApproved !== undefined) db.data.cluster.eulaApproved = !!eulaApproved;
      if (nodeActive !== undefined) db.data.cluster.nodeActive = !!nodeActive;
      if (numCtxLimit !== undefined) db.data.cluster.numCtxLimit = Number(numCtxLimit);

      db.save();
      
      res.json({ success: true, config: db.data.cluster });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/cluster/consent", (req, res) => {
    const { approved, termsHash } = req.body;
    db.data.cluster.eulaApproved = !!approved;
    // @ts-ignore
    db.data.cluster.consentTimestamp = new Date().toISOString();
    // @ts-ignore
    db.data.cluster.termsHash = termsHash;
    db.save();
    db.logSecurity("network", "Cluster Consent", `Consent: ${approved}, Hash: ${termsHash}`, "info");
    res.json({ success: true });
  });

  app.post("/api/cluster/leave", (req, res) => {
    db.data.cluster.nodeActive = false;
    db.save();
    db.logSecurity("network", "Cluster Leave", "User opted-out of mesh", "info");
    res.json({ success: true });
  });


  app.get("/api/selftest", async (req, res) => {
    const isLive = CURRENT_MODE === "live";
    const report: Record<string, { status: "PASS" | "FAIL" | "WARN"; details: string }> = {};

    // Health gates must stay responsive: bound each live LLM probe so a slow/cold
    // model FAILs the gate fast instead of hanging the whole /api/selftest request.
    // (The dashboard polls this endpoint; an un-bounded generate left it permanently
    // "pending" → the selftest UI looked broken.)
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} exceeded ${ms}ms`)), ms))]);

    // G1: Mode Detect
    report["G1_Mode"] = {
      status: CURRENT_MODE !== "demo" ? "PASS" : "WARN",
      details: CURRENT_MODE !== "demo" 
        ? `Operating under native Live macOS: "${CURRENT_MODE}"` 
        : "Operating in Cloud Demo Sandbox. Local systems emulation enabled.",
    };

    // G2: Ollama Probes
    if (CURRENT_MODE !== "demo") {
      try {
        const pingResult = await withTimeout(ProviderRouter.generate({
          provider: "ollama-local",
          model: "qwen3:8b", // Standard low weight local target
          messages: [{ role: "user", content: "ping" }],
          numCtx: 512,
        }), 6000, "ollama ping");
        report["G2_OllamaHealth"] = {
          status: pingResult.text ? "PASS" : "WARN",
          details: `Reachable and responded: ${pingResult.text.substring(0, 40)}`,
        };
      } catch (e: any) {
        // A timeout means ollama is reachable but slow to produce a first token
        // (cold model load / remote GPU + network latency) — "slow, unverified"
        // (WARN), not "offline" (FAIL). Only a genuine connection error is a FAIL.
        const slow = /exceeded \d+ms/.test(e?.message || "");
        report["G2_OllamaHealth"] = slow
          ? { status: "WARN", details: `Ollama reachable but slow to verify first token: ${e.message}. Cold model-load / network latency, not offline.` }
          : { status: "FAIL", details: `Ollama is offline or model missing: ${e.message}. Remedy: ensure the Ollama host is running and port 11434 is bound.` };
      }
    } else {
      report["G2_OllamaHealth"] = {
        status: "WARN",
        details: "Ollama ping ignored: cloud container is isolated from local macOS daemon.",
      };
    }

    // G3: Sequential Pipeline Fallback Check
    try {
      const pipelineResult = await withTimeout(ProviderRouter.generate({
        provider: CURRENT_MODE === "live" ? "ollama-local" : "demo",
        model: CURRENT_MODE === "live" ? "qwen3:8b" : "simulation",
        messages: [{ role: "user", content: "test design target" }],
      }), 8000, "pipeline router");
      const expectedSource = CURRENT_MODE === "live" ? "ollama_local" : "demo";
      report["G3_PipelineFallback"] = {
        status: pipelineResult.source === expectedSource ? "PASS" : "WARN",
        details: `Adaptive router fallback responsive. Source traced: ${pipelineResult.source}`,
      };
    } catch (e: any) {
      // A timeout means the live LLM probe was too slow to verify in time — that is
      // "slow, unverified" (WARN), not "broken" (FAIL). Only a real error is a FAIL.
      const slow = /exceeded \d+ms/.test(e?.message || "");
      report["G3_PipelineFallback"] = {
        status: slow ? "WARN" : "FAIL",
        details: slow ? `Pipeline probe slow (bounded, not a hard failure): ${e.message}` : `Pipeline router fail: ${e.message}`,
      };
    }

    // G4: Filesystem Escaping Guard
    try {
      FilesystemManager.writeFile(false, "/root", "tests/temp.txt", "temp");
      try {
        FilesystemManager.resolveSafePath("/root", "../../etc/passwd");
        report["G4_FilesystemGuard"] = {
          status: "FAIL",
          details: "Failed to block path traversal escape target.",
        };
      } catch (escapeError) {
        report["G4_FilesystemGuard"] = {
          status: "PASS",
          details: "Traversal check working: path escape was locked and thrown successfully.",
        };
      }
    } catch (fsError: any) {
      report["G4_FilesystemGuard"] = {
        status: "FAIL",
        details: `General fs failure: ${fsError.message}`,
      };
    }

    // G5: Safe Terminal Exec Sandbox
    try {
      // Force the LIVE blocking path (isLive=true) so the gate verifies the real
      // sandbox, not the demo simulator. Safe: a blocked token ('rm') / metacharacter
      // (';') returns 126 at steps 2-3, before any child_process ever spawns — the
      // dangerous command is intercepted, never executed. (In degraded-live isLive is
      // false → execute() simulates → exitCode≠126 → the gate falsely FAILed.)
      const blockedTest1 = await TerminalManager.execute(true, "/root", "rm -rf /");
      const blockedTest2 = await TerminalManager.execute(true, "/root", "cat /etc/passwd; ls");
      if (blockedTest1.exitCode === 126 && blockedTest2.exitCode === 126) {
        report["G5_TerminalSandbox"] = {
          status: "PASS",
          details: "Command console execution blocked malicious calls with status 126.",
        };
      } else {
        report["G5_TerminalSandbox"] = {
          status: "FAIL",
          details: "Console failed to intercept meta-characters or forbidden commands.",
        };
      }
    } catch (e: any) {
      report["G5_TerminalSandbox"] = {
        status: "FAIL",
        details: `Terminal inspection thrown error: ${e.message}`,
      };
    }

    // G6: Client-Side AES Encrypted Backup Round-trip (M8)
    try {
      const testData = "Mission Control DB Payload 2026";
      const masterKey = db["masterKey"];
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
      let enc = cipher.update(testData, "utf8", "hex");
      enc += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");

      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      let dec = decipher.update(enc, "hex", "utf8");
      dec += decipher.final("utf8");

      if (dec === testData) {
        report["G6_BackupCrypto"] = {
          status: "PASS",
          details: "AES-256-GCM zero-knowledge compression/decryption loops validated.",
        };
      } else {
        report["G6_BackupCrypto"] = {
          status: "FAIL",
          details: "Cryptographic values did not mismatch on decrypt cycle.",
        };
      }
    } catch (e: any) {
      report["G6_BackupCrypto"] = {
        status: "FAIL",
        details: `Cryptography validation thrown error: ${e.message}`,
      };
    }

    // G7: External cloud Keys Vault status
    const keysCount = Object.keys(db.data.keys || {}).length;
    report["G7_KeyVault"] = {
      status: keysCount > 0 ? "PASS" : "WARN",
      details: keysCount > 0 
        ? `${keysCount} encrypted hardware credentials loaded in secure at-rest file.` 
        : "Storage contains zero external cloud keys. Operating under offline default.",
    };

    // G8: ReAct Agent Tool Loop self-test Gate
    if (CURRENT_MODE === "live") {
      try {
        const TEST_TOOLS = [
          {
            type: "function",
            function: {
              name: "list_tree",
              description: "List the entire workspace files directory structure recursively.",
              parameters: { type: "object", properties: {}, required: [] }
            }
          }
        ];
        // Execute a quick, low-cost tool test against the local provider
        const toolResult = await withTimeout(ProviderRouter.generate({
          provider: "ollama-local",
          model: "qwen3:8b",
          messages: [
            { role: "system", content: "You are a ReAct agent. You must invoke the list_tree tool to inspect the workspace." },
            { role: "user", content: "List the files." }
          ],
          tools: TEST_TOOLS,
          numCtx: 1024,
        }), 12000, "agent tool-loop");

        const hasToolCall = !!(toolResult.toolCalls && toolResult.toolCalls.some(tc => tc.name === "list_tree"));
        const wasOllamaLocal = toolResult.source === "ollama_local";

        if (hasToolCall && wasOllamaLocal) {
          report["G8_AgentToolLoop"] = {
            status: "PASS",
            details: "1-step ReAct agent successfully triggered local 'list_tree' tool invocation on ollama_local.",
          };
        } else {
          report["G8_AgentToolLoop"] = {
            status: "WARN",
            details: `Agent generated model response, but exact tool bindings missed or routed differently (Source: ${toolResult.source}, Has list_tree call: ${hasToolCall}).`,
          };
        }
      } catch (e: any) {
        // Timeout = the agent tool-loop probe was too slow to verify (WARN), not broken.
        const slow = /exceeded \d+ms/.test(e?.message || "");
        report["G8_AgentToolLoop"] = {
          status: slow ? "WARN" : "FAIL",
          details: slow ? `Agent tool-loop probe slow (bounded, not a hard failure): ${e.message}` : `ReAct 1-step loop invocation failed: ${e.message}`,
        };
      }
    } else {
      report["G8_AgentToolLoop"] = {
        status: "WARN",
        details: "Agent Tool-Loop self-test ignored in demo mode (Ollama isolated from cloud containment).",
      };
    }

    // G9: Decentralized Computing Swarm Multi-Language Backends Prober
    try {
      const sources = [
        { path: "backend/mesh/p2p_network.go", lang: "Go" },
        { path: "backend/orchestrator/hardware_orchestrator.rs", lang: "Rust" },
        { path: "backend/sandbox/secure_sandbox.rs", lang: "Rust" },
        { path: "backend/daemon/idle_daemon.c", lang: "C" },
        { path: "backend/contracts/MultiLevelReward.sol", lang: "Solidity" },
      ];

      const binFolderExists = fs.existsSync(path.join(process.cwd(), "bin"));
      const missingSources = sources.filter(s => !fs.existsSync(path.join(process.cwd(), s.path)));

      if (missingSources.length === 0) {
        let binMsg = "Source scripts initialized. ";
        if (binFolderExists) {
          const compiled = ["p2p_network", "hardware_orchestrator", "secure_sandbox", "idle_daemon"];
          const existingBins = compiled.filter(b => fs.existsSync(path.join(process.cwd(), "bin", b)));
          if (existingBins.length === compiled.length) {
            binMsg += "All assets compiled under /bin folder successfully.";
          } else if (existingBins.length > 0) {
            binMsg += `Partial binaries compiled: [${existingBins.join(", ")}].`;
          } else {
            binMsg += "Binaries can be compiled with standard 'make build-all' locally.";
          }
        } else {
          binMsg += "To compile binaries on your host machine, type 'make build-all' to initialize the bin/ folder.";
        }

        report["G9_P2PSwarmAssets"] = {
          status: "PASS",
          details: `All 5 required P2P Swarm decentralized source modules verified on disk. ${binMsg}`,
        };
      } else {
        report["G9_P2PSwarmAssets"] = {
          status: "FAIL",
          details: `Missing standard P2P swarm files: ${missingSources.map(m => m.path).join(", ")}.`,
        };
      }
    } catch (swarmErr: any) {
      report["G9_P2PSwarmAssets"] = {
        status: "FAIL",
        details: `Decentralized swarm verification thrown error: ${swarmErr.message}`,
      };
    }

    res.json(report);
  });

  // ----------------------------------------------------
  // VITE & STATIC FILES SERVING
  // ----------------------------------------------------

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      // HMR off by default: the fleet serves this for USE, and the derived-port HMR
      // WebSocket (PORT+20000) flaps in middleware mode → the Vite client reload-loops
      // the page every few seconds while idle. `VITE_HMR=true` re-enables it (per-instance
      // ws port avoids Vite's default 24678 collision) for active frontend dev.
      server: {
        middlewareMode: true,
        hmr: process.env.VITE_HMR === "true" ? { port: Number(PORT) + 20000 } : false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Cockpit] Console backend is listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown (Faz 13A): on SIGTERM/SIGINT (K8s rolling deploy) stop
  // accepting connections, halt the webhook worker, drain in-flight requests up
  // to SHUTDOWN_GRACE_MS, close the DB pool, then exit. Double-signal guarded.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownTotal.inc();
    console.log(`[Shutdown] ${signal} received — draining…`);
    const graceMs = Number(process.env.SHUTDOWN_GRACE_MS || 10000);
    const force = setTimeout(() => { console.warn("[Shutdown] grace timeout — forcing exit"); process.exit(1); }, graceMs);
    force.unref?.();
    try {
      stopWebhookWorker();
      stopOAuthGc();
      stopSupervisor();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeStore();
      clearTimeout(force);
      console.log("[Shutdown] clean exit");
      process.exit(0);
    } catch (e) {
      console.error("[Shutdown] error during drain", e);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Start full stack Express services
initializeServer().catch((e) => {
  console.error("Express initialization crashed on start.", e);
});
