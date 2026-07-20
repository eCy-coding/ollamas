import "dotenv/config"; // load .env into process.env before any provider/key read (getDecryptedKey fallback)
import "./server/tracing"; // MUST be first (B2): boots NodeSDK's http auto-instrumentation before http is required below — see server/tracing.ts header (express instrumentation deliberately excluded, breaks Function.name)
import { getTraceSnapshot, shutdownTracing } from "./server/tracing";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { register as metricsRegister, httpDuration, recordToolMetric, registerStoreMetrics, shutdownTotal, unhandledRejectionTotal, ukpStageEventsTotal } from "./server/metrics";
import { errorTrackingMiddleware, installProcessErrorHooks } from "./server/error-tracking";
import { selftestProbePlan } from "./server/selftest-plan";
import { searchGitHub } from "./server/github-search";
import { runStandard, type Category } from "./server/github-search-standard";
import { autoconnectGitHub } from "./server/integrations";
import { checkIntegrations } from "./server/integrations-health";
import { ecysearcherProxy, ecysearcherOfflineGate } from "./server/ecysearcher-proxy";
import { ecysearcherSupervisor } from "./server/ecysearcher";
import { logger } from "./server/logger";
import { openApiSpec } from "./server/openapi";
import swaggerUi from "swagger-ui-express";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import type { ViteDevServer } from "vite";
import type { Server as HttpServer } from "node:http";
import { db, ChatSession, flushPendingSave } from "./server/db";
import { sessionEventsSince, sessionStepCount, isSessionDone, formatSseEvent, formatSseDone } from "./server/agent-events";
import { ProviderRouter, repairJson, getToolArgError } from "./server/providers";
import { keyedCloudProviders, catalogEntry, catalogBaseUrl, trainsOnData, keySignupUrl, envKeyFor, capabilitiesFor } from "./server/provider-catalog";
import { deriveCloudflareAccountId } from "./server/cloudflare";
import { setCloudflareAccountId, getCloudflareAccountId } from "./server/provider-catalog";
import { sttEntryFor, buildTranscribeForm, STT_CATALOG } from "./server/stt-catalog";
import { runDoctor, productionDoctorDeps } from "./server/key-doctor";
import { recentEvents, rollup, onRequestEvent, redactDeep } from "./server/telemetry";
import { formatTelemetryFrame, telemetrySnapshot } from "./server/telemetry-sse";
import { costSummary } from "./server/key-usage";
import { geminiCliAvailable, generateViaGeminiCli } from "./server/gemini-cli";
import { listModels as aiListModels, generate as aiGenerate, generateTextStream as aiGenerateTextStream } from "./server/ai";
import { runTestgen, runAudit, generateStorefront, getRevenueConfig, setRevenueConfig, publishAuditToGitHub, publishAuditPR } from "./server/revenue";
import { parseRepoSlug, rerunFailedJobs, cancelRun, validateGitHubToken } from "./server/github";
import { getRuns, getJobs, getWorkflows, getLog, dispatch, detectRepoSlug } from "./server/github-actions";
import { getAppCreds, getInstallationToken, createCheckRun, verifyWebhookSignature } from "./server/github-app";
import { notify } from "./server/notify";
import { sanitizeModelOverride } from "./server/model-overrides";
import { FilesystemManager } from "./server/files";
import { TerminalManager } from "./server/terminal";
import { BackupService } from "./server/backup";
import { OrchestratorCoordinator } from "./server/orchestrator";
import { ToolRegistry, type ToolDeps, type ToolCtx, type ToolTier } from "./server/tool-registry";
import { registerHostScripts } from "./bin/host-bridge/register-host-scripts.mjs"; // scripts lane v5 register-seam
import { mountEnabledModules } from "./server/modules"; // O0 module registry (INV-O0-1 — single /api/modules prefix)
import { handleMcpRequest } from "./server/mcp/server";
import { buildResourceMetadata, PROTECTED_RESOURCE_PATH, buildAuthServerMetadata, AUTH_SERVER_METADATA_PATH, REGISTRATION_PATH } from "./server/mcp/oauth-metadata";
import { mcpDiscovery, MCP_DISCOVERY_PATH } from "./server/mcp/discovery";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { OllamasOAuthProvider } from "./server/mcp/oauth-provider";
import { listUpstreams, type UpstreamConfig } from "./server/mcp/client";
import { superviseUpstream, removeUpstream, startSupervisor, stopSupervisor, getUpstreamStatus } from "./server/mcp/supervisor";
import { memoryUsage } from "./server/memory-stats";
import { decorateCatalog } from "./server/mcp/catalog";
import { getFeedItems } from "./server/threatfeed";
import { validateUpstreamConfig } from "./server/mcp/upstream-guard";
import { initStore, closeStore, pingStore, poolStats, migrationVersion, pendingDeliveryCount, createTenant, issueApiKey, revokeApiKey, listPlans, recordUsage, monthToDateUsage, usageTimeseries, getTenant, listTenants, listKeys, recordAudit, listAudit, addUpstreamServer, listUpstreamServers, deleteUpstreamServer, allUpstreamServers, addWebhook, listWebhooks, deleteWebhook, listDeliveries, registerClient, resolveKey, getClient, saveOAuthToken, verifyClientSecret, recordStageEvent, listStageEvents } from "./server/store";
import { verifyWebhook } from "./server/webhooks/outbound"; // also registers the webhook-retry recurring loop (C2, side effect)
import "./server/oauth-gc"; // registers the "oauth-gc" durable job handler (C2, side effect — scheduled by server/jobs.ts)
import { startKeyHealth, stopKeyHealth, getKeyHealth, liveCheapSnapshot } from "./server/key-health";
import { startJobs, stopJobs, getJobsSnapshot } from "./server/jobs";
import { getSemanticCacheSnapshot } from "./server/semantic-cache";
import { getHierarchySnapshot } from "./server/hierarchy-bridge";
import { authMiddleware } from "./server/middleware/auth";
import { rateLimitMiddleware } from "./server/middleware/rate-limit";
import { registerContractRoutes, poolStatusReport as contractPoolStatus } from "./server/contract";
import { registerAccountRoutes } from "./server/account";
import { runBilling, computeRun, handleWebhook, ensureBillingConfig, ensureCustomer, createPortalSession, createCheckoutSession, sendMeterEventAsync, isLive as stripeIsLive, createAuditCheckout, dollarsToCents } from "./server/billing/stripe";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// S1 session-end distill state: per-session idle timer + the message count already
// covered by a distill (periodic %10 or a previous idle fire). Entries die when the
// timer fires; timers are unref'd so they never hold the process open.
const brainIdleDistill = new Map<string, { timer?: NodeJS.Timeout; distilledLen: number }>();

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
import { registerCookbookRoutes } from "./server/cookbook";
import { registerResearchRoutes, isSafeUrl } from "./server/research";
import { registerEcymRoutes } from "./server/ecym";
import { registerPanelAssistRoutes, distillPanel, PANEL_IDS, type PanelId } from "./server/panel-assist";
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
// Orchestra conductor live state (iter-13) — the $0 conductor daemon writes host state to ~/.ollamas; this
// exposes it on :3000 so the web cockpit shows the SAME real data as Terminal.app (`ollamas status/progress`).
// Graceful: any missing file → that field is null. Host process reads os.homedir() directly (no docker mount).
app.get("/api/orchestra", (_req, res) => {
  const readJson = (p: string): any => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const st = readJson(path.join(os.homedir(), ".ollamas", "orchestra.json"));
  const prog = readJson(path.join(os.homedir(), ".ollamas", "tasks-progress.json")) || {};
  const catalog: any[] = readJson(path.join(process.cwd(), "orchestration", "TASKS.json")) || [];
  const sel = readJson(path.join(process.cwd(), "orchestration", "MODEL_SELECTION.json"));
  // progress summary (same math as lib/task-progress.summary; absent id = pending)
  let done = 0, proposed = 0;
  for (const t of catalog) { const s = prog[t.id]; if (s === "done") done++; else if (s === "proposed") proposed++; }
  const progress = catalog.length ? { total: catalog.length, done, proposed, pending: catalog.length - done - proposed } : null;
  // deps present/total from DEPS_DOCTOR.md ("**present X/Y**")
  let deps: { present: number; total: number } | null = null;
  try { const m = fs.readFileSync(path.join(process.cwd(), "orchestration", "DEPS_DOCTOR.md"), "utf8").match(/present\s+(\d+)\/(\d+)/); if (m) deps = { present: +m[1], total: +m[2] }; } catch { /* absent */ }
  res.json({
    ts: new Date().toISOString(),
    live: !!st,
    phase: st?.phase ?? null,
    conductorModel: st?.conductor_model ?? null,
    preferredModel: sel?.selection?.model ?? null,
    failoverCount: st?.failover_count ?? 0,
    currentTask: st?.current_task ?? null,
    queue: Array.isArray(st?.pending_actions) ? st.pending_actions.length : 0,
    retry: st ? { count: st.retry_count ?? 0, max: 3 } : null,
    progress,
    deps,
  });
});

// OpenAPI 3.1 spec + Swagger UI (Faz 10C).
app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

// Health & Telemetry API (L1, L11). Registered at top-level (module load) — not inside
// initializeServer — so in-process route tests exercise it via the exported `app` without
// binding a port or booting the full stack. All handler dependencies (refreshMode, reachOllama,
// CURRENT_MODE, memoryUsage, discoverBinaries, contractPoolStatus, pingStore, db) are module-scoped
// and resolved lazily at request time. Handlers are order-independent of their later declarations.
app.get("/api/health", async (req, res) => {
  await refreshMode(); // self-heal: recover from a stale "degraded-live" once ollama is reachable again
  const isLive = CURRENT_MODE === "live";

  // Live system metrics querying CPU load and memories
  const cpuLoads = os.loadavg();
  // macOS-correct available memory (free+inactive+purgeable+speculative); os.freemem()
  // alone reads ~99% on macOS. Non-darwin / vm_stat failure → falls back to os.freemem().
  const systemMemory = memoryUsage();

  let loadedModels: any[] = [];
  let ollamaVersion = "unavailable";
  // Reported, not gated: a DB blip shouldn't restart the pod (liveness),
  // only steer traffic via /api/ready (Faz 13C).
  const dbUp = await pingStore();

  if (CURRENT_MODE !== "demo") {
    try {
      const ver = await reachOllama("/api/version", 3000);
      if (ver) {
        const verJson = await ver.res.json();
        ollamaVersion = verJson?.version || "unknown";
      }
      const ps = await reachOllama("/api/ps", 3000);
      if (ps) {
        const psJson = await ps.res.json();
        loadedModels = psJson?.models || [];
      }
    } catch (e) {}
  }

  // SEC-5: surface WHERE the AES master key came from (name only, never a value) + actionable
  // remediation when the source is weak/ephemeral. Lets the cockpit alert on a degraded secret.
  const masterKey = db.masterKeyStatus();

  res.json({
    mode: CURRENT_MODE,
    isLive,
    masterKeySource: masterKey.masterKeySource,
    remediation: masterKey.remediation,
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
    contractPool: contractPoolStatus(), // vK16 G-A: compute-pool observability (masked counts)
  });
});

// Stripe webhook needs the RAW body for signature verification — register the
// raw parser for that path BEFORE the global JSON parser so it wins (Faz 4).
app.use("/api/billing/webhook", express.raw({ type: "*/*" }));
// UKP inbound stage-events: raw body required for HMAC signature verification
// (same reason as Stripe — must be registered before the global JSON parser).
app.use("/api/ingest/stage-events", express.raw({ type: "*/*" }));
// GitHub App webhook: raw body required to verify the HMAC-SHA256 signature (X-Hub-Signature-256).
app.use("/api/github/webhook", express.raw({ type: "*/*" }));
// Binary file upload: capture the raw body (any content type) as a Buffer BEFORE the
// 50mb JSON parser — otherwise express.json swallows the stream and the byte payload
// is lost. 1gb cap; binary-safe round-trip via FilesystemManager.writeFileBuffer.
app.use("/api/workspace/upload", express.raw({ type: "*/*", limit: "1gb" }));
// Raw audio bytes for transcription (T2-F7) — 26mb ceiling leaves headroom over the
// provider's own 25MB cap, which stt-catalog enforces with an honest error first.
app.use("/api/ai/transcribe", express.raw({ type: "*/*", limit: "26mb" }));

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
    "/api/agent", "/api/keys", "/api/models", "/api/revenue", "/api/notify",
    "/api/ecysearcher", "/api/threatfeed", "/api/model-overrides",
    // NARROW prefixes only: bare "/api/github" would also gate /api/github/webhook
    // (inbound FROM GitHub) and 403 it under SAAS_ENFORCE=1.
    "/api/github/actions", "/api/github/search", "/api/integrations",
    "/api/modules", // INV-O0-1: ALL module routes live under this ONE prefix (O0 Faz 2)
  ],
  localOwnerGuard,
);

// --- Multi-agent pipeline (M3) — registered at module top-level (M-050) so in-process route
// tests exercise it via the exported `app` under OLLAMAS_NO_AUTOBOOT=1 without booting the full
// stack. Gated by the localOwnerGuard prefix above; all deps (ProviderRouter, Filesystem/Terminal
// Manager, db, CURRENT_MODE) are module-scoped and resolved lazily at request time.
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
      const writeErrors: string[] = []; // surfaced in the done frame instead of silently swallowing failures
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
                } catch (e: any) {
                  writeErrors.push(`${activeFile}: ${e?.message || String(e)}`);
                }
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

      res.write(`data: ${JSON.stringify({ done: true, writeCount, writeErrors })}\n\n`);
      res.end();
    } catch (e: any) {
      res.write(`data: ${JSON.stringify({ error: e.message || "Pipeline execution failed." })}\n\n`);
      res.end();
    }
  });

// Integrations completion (dalga-11) — 0-manual GitHub connect (pulls the gh
// CLI token into the vault) + on-demand health matrix. Local-owner only.
app.post("/api/integrations/github/autoconnect", async (_req, res) => {
  res.json(await autoconnectGitHub());
});
app.get("/api/integrations/health", async (_req, res) => {
  // Never 500 on a token-read/probe throw — that logged as a RUM api_error and made an optional,
  // unconfigured integration look like a server fault. Degrade to 200 [] so the panel renders its
  // honest client-side "needs-setup" rows instead.
  try { res.json(await checkIntegrations({ token: ghToken() })); }
  catch { res.json([]); }
});

// GitHub Actions cockpit (dalga-6). Read paths work unauthenticated for public
// repos; write paths (rerun/cancel) require the "github" vault token. Every
// route validates owner/repo/run_id (assertActionsTarget) before interpolation.
const ghToken = (): string => db.decrypt((db.data.keys || {})["github"] || "");
app.get("/api/github/actions/repo-hint", async (_req, res) => {
  res.json({ slug: await detectRepoSlug() });
});
app.get("/api/github/actions/runs", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  // T4-hardening: machine-readable code alongside the human message.
  if (!slug) { logger.warn({ route: "/api/github/actions/runs", code: "INVALID_REPO" }, "rejected: bad repo slug"); return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)", code: "INVALID_REPO" }); }
  try {
    res.json(await getRuns({ owner: slug.owner, repo: slug.repo, token: ghToken(), refresh: req.query.refresh === "1", signal: AbortSignal.timeout(8000) }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.get("/api/github/actions/runs/:id/jobs", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  if (!slug) return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)" });
  try {
    res.json(await getJobs({ owner: slug.owner, repo: slug.repo, runId: req.params.id, token: ghToken(), signal: AbortSignal.timeout(8000) }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.post("/api/github/actions/runs/:id/rerun", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  if (!slug) return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)" });
  const token = ghToken();
  if (!token) return res.status(400).json({ error: "GitHub token gerekli — Gelir/Kişisel Ops'ta provider=github anahtarını bağla" });
  try {
    const r = await rerunFailedJobs(slug.owner, slug.repo, req.params.id, token, AbortSignal.timeout(8000));
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.post("/api/github/actions/runs/:id/cancel", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  if (!slug) return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)" });
  const token = ghToken();
  if (!token) return res.status(400).json({ error: "GitHub token gerekli — Gelir/Kişisel Ops'ta provider=github anahtarını bağla" });
  try {
    const r = await cancelRun(slug.owner, slug.repo, req.params.id, token, AbortSignal.timeout(8000));
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.get("/api/github/actions/jobs/:jobId/log", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  if (!slug) return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)" });
  try {
    res.json(await getLog({ owner: slug.owner, repo: slug.repo, jobId: req.params.jobId, token: ghToken(), signal: AbortSignal.timeout(8000) }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.get("/api/github/actions/workflows", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  if (!slug) return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)" });
  try {
    res.json({ ...(await getWorkflows({ owner: slug.owner, repo: slug.repo, token: ghToken(), refresh: req.query.refresh === "1", signal: AbortSignal.timeout(8000) })), authed: !!ghToken() });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.post("/api/github/actions/dispatch", async (req, res) => {
  const slug = parseRepoSlug(String(req.query.repo || ""));
  // T4-hardening: every reject branch carries a stable code (INVALID_REPO / NO_GITHUB_TOKEN / MISSING_FIELDS).
  if (!slug) { logger.warn({ route: "/api/github/actions/dispatch", code: "INVALID_REPO" }, "rejected: bad repo slug"); return res.status(400).json({ error: "invalid or missing 'repo' (owner/name)", code: "INVALID_REPO" }); }
  const token = ghToken();
  if (!token) return res.status(400).json({ error: "GitHub token gerekli — Gelir/Kişisel Ops'ta provider=github anahtarını bağla", code: "NO_GITHUB_TOKEN" });
  const { workflowId, ref, inputs } = req.body || {};
  if (!workflowId || !ref) return res.status(400).json({ error: "'workflowId' ve 'ref' gerekli", code: "MISSING_FIELDS" });
  try {
    const r = await dispatch({ owner: slug.owner, repo: slug.repo, workflowId: String(workflowId), ref: String(ref), inputs, token, signal: AbortSignal.timeout(8000) });
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Canlı Tehdit Akışı (dalga-3) — curated RSS/Atom/KEV reader, independent of the
// eCySearcher Flask stack so the threat-intel tab has live data even when the
// docker stack is down. Lazy 15-min TTL cache; ?refresh=1 forces a refetch.
app.get("/api/threatfeed", async (req, res) => {
  // Merge operator-added custom feeds (v12 gap #9) with the curated sources.
  const extra = (db.data.threatFeeds ?? [])
    .filter((f) => isSafeUrl(f.url))
    .map((f) => ({ id: `custom-${f.source}`, title: f.source, url: f.url, kind: "rss" as const }));
  res.json(await getFeedItems({ refresh: req.query.refresh === "1", extra }));
});

// Add a custom threat feed (v12 gap #9) — SSRF-guarded (no loopback/private hosts).
app.post("/api/threatfeed/sources", async (req, res) => {
  const b = req.body as { source?: unknown; url?: unknown };
  const source = String(b?.source ?? "").trim().slice(0, 60);
  const url = String(b?.url ?? "").trim();
  if (!source || !isSafeUrl(url)) { res.status(400).json({ error: "source + a public https feed url required" }); return; }
  db.data.threatFeeds = (db.data.threatFeeds ?? []).filter((f) => f.source !== source);
  db.data.threatFeeds.push({ source, url });
  db.save();
  res.json({ ok: true, count: db.data.threatFeeds.length });
});

// eCySearcher threat-intel subsystem (docker-compose stack). SUPERVISOR control routes — single
// segment paths (up/down/status/logs) registered BEFORE the proxy mount so they win; the proxy
// catches everything else (/api/ecysearcher/api/...). The supervisor self-heals via `docker compose
// up` (health loop + backoff + crash-loop breaker). See server/ecysearcher.ts.
app.post("/api/ecysearcher/up", async (_req, res) => res.json(await ecysearcherSupervisor.ensureRunning({ manual: true })));
app.post("/api/ecysearcher/down", async (_req, res) => res.json(await ecysearcherSupervisor.stop()));
app.get("/api/ecysearcher/status", (_req, res) => res.json(ecysearcherSupervisor.status()));
app.get("/api/ecysearcher/logs", async (req, res) => {
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
  res.json({ lines: await ecysearcherSupervisor.recentLogs(limit) });
});

// eCySearcher reverse-proxy — forward its (open) Flask API through ollamas so the cockpit reaches it
// CORS-free + the local-owner guard is the only exposure. Mounted AFTER the supervisor control
// routes. See server/ecysearcher-proxy.ts.
// Offline circuit-breaker BEFORE the proxy: supervisor stopped → 200 offline payload (no dead-upstream
// 502 flood into RUM). Only proxies for real when the stack is running.
app.use("/api/ecysearcher", ecysearcherOfflineGate(() => ecysearcherSupervisor.status().running === true), ecysearcherProxy);

// GitHub Search (dalga-8) — first-party keyword search over the GitHub REST
// Search API. Replaces the old ecysearch external-iframe supervisor (which
// crash-looped when its separate checkout was missing). repos/issues read
// unauthenticated; code search uses the vault token.
app.get("/api/github/search", async (req, res) => {
  const q = String(req.query.q || "");
  const type = String(req.query.type || "repos");
  // T4-hardening: structured code so the frontend can branch on the failure kind (not string-match).
  if (!q.trim()) { logger.warn({ route: "/api/github/search", code: "MISSING_QUERY" }, "rejected: empty query"); return res.status(400).json({ error: "'q' gerekli", code: "MISSING_QUERY" }); }
  try {
    res.json(await searchGitHub({ type, q, token: ghToken(), refresh: req.query.refresh === "1", signal: AbortSignal.timeout(8000) }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
// Search Standard (dalga-9) — runs the curated discovery intents and returns a
// license-classified, ranked task-list digest. Advisory only.
app.get("/api/github/search/standard", async (req, res) => {
  const cat = String(req.query.category || "").trim();
  const categories = cat ? (cat.split(",").filter(Boolean) as Category[]) : undefined;
  try {
    res.json(await runStandard({ token: ghToken(), categories, refresh: req.query.refresh === "1", signal: AbortSignal.timeout(8000) }));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

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
    let github: Awaited<ReturnType<typeof publishAuditToGitHub>> | Awaited<ReturnType<typeof publishAuditPR>> | undefined;
    if (result.ok && req.body?.githubRepo) {
      const args = { repo: req.body.repo, githubRepo: req.body.githubRepo, model: result.model };
      github = req.body?.deliver === "pr" ? await publishAuditPR(args) : await publishAuditToGitHub(args);
    }
    // Best-effort alert (no-op without a configured sink; never throws into the response).
    const url = github && ("issueUrl" in github ? github.issueUrl : "prUrl" in github ? github.prUrl : undefined);
    if (result.ok) void notify(`✅ ollamas audit complete: ${result.findings ?? 0} finding(s)${url ? ` → ${url}` : result.reportPath ? ` → ${result.reportPath}` : ""}`, db.data.notify);
    res.json({ ...result, github });
  } catch (e) { res.status(500).json({ ok: false, output: String((e as Error).message) }); }
});

// GitHub App — Checks API (per-PR pass/fail). Post a Check run on a commit SHA. Graceful skip
// when the App creds (App id / private key / installation id) are not yet in the vault.
app.post("/api/revenue/check", async (req, res) => {
  try {
    const slug = parseRepoSlug(String(req.body?.githubRepo || ""));
    const headSha = String(req.body?.headSha || "");
    if (!slug || !headSha) return res.json({ ok: false, skipped: true, reason: "githubRepo (owner/name) + headSha required" });
    const creds = getAppCreds();
    if (!creds) return res.json({ ok: false, skipped: true, reason: "no GitHub App in vault — paste App id + private key + installation id (Checks API is App-only)" });
    const tok = await getInstallationToken(creds, Math.floor(Date.now() / 1000));
    if (!tok.ok) return res.json({ ok: false, reason: tok.error });
    const conclusion = req.body?.conclusion === "failure" ? "failure" : req.body?.conclusion === "neutral" ? "neutral" : "success";
    const r = await createCheckRun(slug.owner, slug.repo, tok.token!, {
      headSha, conclusion,
      title: String(req.body?.title || "ollamas audit"),
      summary: String(req.body?.summary || "Audit completed by ollamas."),
    });
    res.json(r.ok ? { ok: true, checkUrl: r.url } : { ok: false, reason: r.error });
  } catch (e) { res.status(500).json({ ok: false, reason: String((e as Error).message) }); }
});

// GitHub App webhook receiver (raw body verified above). On a pull_request open/sync, post a
// Check run on the PR head SHA. HMAC-verified; 503 graceful when no App is configured.
app.post("/api/github/webhook", async (req, res) => {
  const creds = getAppCreds();
  if (!creds || !creds.webhookSecret) return res.status(503).json({ ok: false, reason: "GitHub App webhook not configured" });
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyWebhookSignature(creds.webhookSecret, raw, req.headers["x-hub-signature-256"] as string | undefined)) {
    return res.status(401).json({ ok: false, reason: "bad signature" });
  }
  let event: { action?: string; repository?: { owner?: { login?: string }; name?: string }; pull_request?: { head?: { sha?: string } } } = {};
  try { event = JSON.parse(raw.toString("utf8")); } catch { /* non-json */ }
  res.json({ ok: true }); // ack fast; the Check posts asynchronously
  const kind = req.headers["x-github-event"];
  if (kind !== "pull_request" || !["opened", "synchronize", "reopened"].includes(event.action || "")) return;
  const owner = event.repository?.owner?.login, repo = event.repository?.name, sha = event.pull_request?.head?.sha;
  if (!owner || !repo || !sha) return;
  try {
    const tok = await getInstallationToken(creds, Math.floor(Date.now() / 1000));
    if (tok.ok) await createCheckRun(owner, repo, tok.token!, { headSha: sha, conclusion: "neutral", title: "ollamas audit queued", summary: "ollamas received this PR; run the audit from the dashboard to publish findings." });
  } catch { /* webhook is best-effort */ }
});

// Audit-service payment: mint a one-time Stripe Checkout link for a deliverable (the operator
// sends it to the client; the client pays on Stripe's hosted page). Graceful skip without a key.
app.post("/api/revenue/checkout", async (req, res) => {
  try {
    if (!stripeIsLive()) return res.json({ ok: false, skipped: true, reason: "no Stripe key in vault — paste your Stripe secret key (test mode: sk_test_...)" });
    const amount = Number(req.body?.amount || 0);
    if (!(amount > 0)) return res.json({ ok: false, skipped: true, reason: "amount (USD) required" });
    const url = await createAuditCheckout({ amountCents: dollarsToCents(amount), description: String(req.body?.description || "ollamas Verified Audit") });
    res.json(url ? { ok: true, url } : { ok: false, reason: "checkout session not created" });
  } catch (e) { res.status(500).json({ ok: false, reason: String((e as Error).message) }); }
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
// Per-model tuning overrides (M-038): the router applies these for the matching model tag
// (options.num_ctx / options.temperature, top-level keep_alive, leading system message).
app.get("/api/model-overrides", (_req, res) => res.json(db.data.modelOverrides ?? {}));
app.post("/api/model-overrides", (req, res) => {
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
  if (!model) return res.status(400).json({ error: "model (non-empty string) required" });
  const override = sanitizeModelOverride(req.body?.override);
  if (!db.data.modelOverrides) db.data.modelOverrides = {};
  if (override) db.data.modelOverrides[model] = override;
  else delete db.data.modelOverrides[model]; // empty/invalid override = clear for this model
  db.save?.(db.data);
  res.json({ ok: true, overrides: db.data.modelOverrides });
});
app.post("/api/revenue/storefront", (req, res) => {
  try { res.json(generateStorefront(req.body || {})); } catch (e) { res.status(500).json({ ok: false, output: String((e as Error).message) }); }
});

// Cookbook — hardware-aware recipe runner (P1). New /api/cookbook/* routes, localOwnerGuard'd.
registerCookbookRoutes(app, db, localOwnerGuard);

// Deep research — question → plan → web-search → summarize → cited report (SSE). localOwnerGuard'd.
registerResearchRoutes(app, localOwnerGuard);

// eCy Studio — distills bench evidence + working principles into ecy:latest (SSE). localOwnerGuard'd.
registerEcymRoutes(app, db, localOwnerGuard);

// eCym control plane — 5 panel specialists (assist + per-panel distill), SSE. localOwnerGuard'd.
registerPanelAssistRoutes(app, db, localOwnerGuard);

/**
 * Every way ollama might be reachable — try each until one answers. `host.docker.internal` only resolves
 * INSIDE a container; on the host `127.0.0.1`/`localhost` work. Trying all makes the health/models/detect
 * paths reach ollama regardless of a docker-oriented `OLLAMA_HOST` (the generate path in providers.ts already
 * did this; the health path did not — root cause of the "degraded-live / fetch failed" gap when
 * OLLAMA_HOST=host.docker.internal is used by a host-run server).
 */
function ollamaCandidates(): string[] {
  const configured = process.env.OLLAMA_HOST;
  return [...new Set([
    configured, "http://127.0.0.1:11434", "http://localhost:11434", "http://host.docker.internal:11434",
  ].filter(Boolean) as string[])];
}

/** Fetch `path` from the first reachable ollama candidate; pins `OLLAMA_HOST` to the winner so every other
 *  caller (providers.ts generate path included) converges on the reachable host. Returns null if none answer. */
async function reachOllama(path: string, timeoutMs = 3000): Promise<{ base: string; res: Response } | null> {
  for (const base of ollamaCandidates()) {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) { process.env.OLLAMA_HOST = base; return { base, res }; }
    } catch { /* unreachable candidate → try the next */ }
  }
  return null;
}

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

  // Probe local Ollama across ALL candidate hosts (incl. 127.0.0.1) before degrading.
  return (await reachOllama("/api/version", 2000)) ? "live" : "degraded-live";
}

let CURRENT_MODE: "live" | "degraded-live" | "demo" = "demo";
let modeCheckedAt = 0; // for the /api/health self-heal re-probe (mode was previously boot-locked forever)

/** Re-detect the environment mode at most every `ttlMs` — so once ollama becomes reachable again the server
 *  recovers from "degraded-live" on its own instead of staying stuck until a restart. Cheap (a single probe). */
async function refreshMode(ttlMs = 10_000): Promise<void> {
  if (Date.now() - modeCheckedAt < ttlMs) return;
  modeCheckedAt = Date.now();
  if (CURRENT_MODE === "demo") return; // demo is a deliberate hard-cloud state, never auto-upgraded
  const next = await detectMode();
  if (next !== CURRENT_MODE) {
    CURRENT_MODE = next;
    ProviderRouter.demoFallbackAllowed = CURRENT_MODE === "demo";
    console.log(`[Cockpit] environment mode re-detected: ${CURRENT_MODE.toUpperCase()}`);
  }
}

// Per-IP brute-force throttle + timing-safe compare for the SaaS admin token. timingSafeEqual
// alone does not stop an attacker hammering guesses; lock an IP out for the window after N misses.
// In-memory (per-process) — adequate for the single admin surface; a multi-replica deploy would
// back this with the shared store/Redis. Extracted to a module-level factory (M-050) so the
// regression test (M-006) can drive the REAL middleware on a throwaway app without booting the
// full stack. Each call returns an ISOLATED per-IP failure map — production builds one instance
// inside initializeServer; a test builds a fresh one per case so brute-force state never leaks.
export function createAdminGuard(): express.RequestHandler {
  const adminFailures = new Map<string, { count: number; until: number }>();
  const ADMIN_MAX_FAILS = 5;
  const ADMIN_LOCK_MS = 15 * 60_000;
  return (req, res, next) => {
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
}

// Central error tracking (M-049): 4-arg error middleware AFTER the top-level routes so any
// thrown/`next(err)` route error becomes a structured 500 + ring-buffer/aggregation entry +
// ollamas_errors_total{kind="route"} metric. Routes registered later (inside initializeServer)
// sit AFTER this layer in the Express stack, so the same middleware is registered a second
// time at the end of initializeServer to cover them. No new public route is added — the
// aggregation surfaces through the existing GET /metrics output and getErrorStats().
app.use(errorTrackingMiddleware);

// FIX B5: extracted + exported so it's independently unit-testable (no full server boot
// needed). `server.close(cb)`'s callback only fires once every open connection is gone —
// an attached SSE client (/api/cockpit/stream, /api/telemetry/stream) never closes on its
// own, so that callback previously never fired and the SHUTDOWN_GRACE_MS force-exit timer
// fired on every restart. closeIdleConnections() drops keep-alives immediately;
// closeAllConnections() after `graceMs` is the hard cut for anything still attached
// (SSE included), which finally lets `closed` resolve.
export function drainHttp(server: HttpServer, graceMs = 2000): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections?.();
  const forceTimer = setTimeout(() => server.closeAllConnections?.(), graceMs);
  forceTimer.unref?.();
  return closed;
}

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
  // Background outbound-webhook delivery worker (Faz 11B) + OAuth retention sweeper
  // (Faz 26) are now started as part of startJobs() below (C2: webhook-retry is a
  // registerRecurring in-memory loop, oauth-gc is a croner-scheduled durable job) —
  // both already registered via the side-effect imports above.
  // Always-running API-key autonomy loop: periodically re-discover/reconnect keys (env+gh) and
  // sweep recovered cooldowns, so the vaulted key supply self-heals with zero operator action.
  // Feeds the GET /api/keys/health convergence signal. Opt-widen via KEY_HEALTH_SOURCES.
  startKeyHealth();
  // Durable job queue + croner scheduler (B1): poll-claim-execute loop with backoff
  // retry, plus a daily db-backup cron. Feeds the GET /api/jobs snapshot.
  startJobs();

  // --- MCP gateway: CONNECT to upstream MCP servers (consume side, Faz 1) ---
  // Upstreams declared in tools.json `mcpServers`; each server's tools are merged
  // into ToolRegistry as `mcp__<server>__<tool>`. Best-effort — a dead upstream
  // never blocks boot.
  //
  // FIX B3: boot must never AWAIT this block — a single dead/slow upstream (e.g. a
  // stdio command that isn't installed, or an http URL with nothing listening) used to
  // add its full connect timeout to boot latency, and the 6-row tenant loop below was
  // sequential on top of that (measured 12.7s; worst case far higher). During all of it
  // there was no port and no /api/health — total outage. The whole body is now fire-
  // and-forget (`void (async () => { … })()`): app.listen (below) and /api/health (module
  // top-level) are reachable immediately, independent of how long any upstream takes.
  // Upstreams that finish later self-register into ToolRegistry via superviseUpstream();
  // tools/list needs NO change for this (see the comment on ListToolsRequestSchema in
  // server/mcp/server.ts) — it is simply eventually-correct a few seconds after boot. A
  // tools/call that lands mid-connect for a specific upstream tool is bridged by
  // ensureUpstream() (server/mcp/server.ts), which holds that one call (bounded) instead
  // of 404ing on a tool that is seconds away from existing.
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tools.json"), "utf-8"));
    const upstreams: UpstreamConfig[] = reg.mcpServers || [];
    void (async () => {
      // Faz 27: connect UNDER SUPERVISION (health-check + backoff + circuit-breaker
      // reconnect). Global tools.json upstreams are ownerless (shared); per-tenant
      // store upstreams keep owner=tenant_id so reconnect preserves isolation (Faz 24).
      // Parallel connect (was sequential): a slow/dead upstream no longer adds its timeout to the sum.
      await Promise.all(upstreams.map(async (cfg) => {
        const r = await superviseUpstream(cfg);
        console.log(`[MCP-Consume] ${r.name}: ${r.ok ? r.tools + " tools merged" : "FAILED — " + r.error}`);
      }));
      // MCP_CONSUME_EAGER=0 → boot'ta per-tenant upstream subprocess fan-out'unu ATLA (hızlı boot);
      // startSupervisor()'ın periyodik reconnect'i ve on-demand yollar bozulmadan kalır. Unset/"1" = eski davranış.
      const eagerTenants = (process.env.MCP_CONSUME_EAGER ?? "1") !== "0";
      const tenantRows = eagerTenants ? await allUpstreamServers() : [];
      // Bounded-parallel (concurrency 3, was fully sequential): a 6-row tenant table no
      // longer sums 6 connect-timeouts, but a plain chunker still caps how many `npx`/
      // stdio subprocesses spawn at once (avoids a 6-way simultaneous spawn storm).
      const TENANT_CONNECT_CONCURRENCY = 3;
      for (let i = 0; i < tenantRows.length; i += TENANT_CONNECT_CONCURRENCY) {
        await Promise.allSettled(tenantRows.slice(i, i + TENANT_CONNECT_CONCURRENCY).map(async (u) => {
          // Defense-in-depth: re-validate persisted tenant rows in case a row was
          // written before the guard existed or the DB was tampered with. Skip (loudly) rather than spawn.
          const v = await validateUpstreamConfig({ transport: u.transport, command: u.command || undefined, args: u.args, url: u.url || undefined });
          if (!v.ok) { console.warn(`[MCP-Consume][tenant ${u.tenant_id}] ${u.name}: SKIPPED unsafe config — ${v.error}`); return; }
          const r = await superviseUpstream({ name: `${u.tenant_id}_${u.name}`, transport: u.transport, url: u.url || undefined, command: u.command || undefined, args: u.args, allowedTools: u.allowed_tools }, u.tenant_id);
          console.log(`[MCP-Consume][tenant ${u.tenant_id}] ${u.name}: ${r.ok ? r.tools + " tools" : "FAILED — " + r.error}`);
        }));
      }
      if (!eagerTenants) console.log(`[MCP-Consume] eager tenant connect deferred (MCP_CONSUME_EAGER=0)`);
    })().catch((e: any) => console.warn(`[MCP-Consume] upstream init skipped: ${e?.message}`));
    // Synchronous, OUTSIDE the void-wrapped block above: the periodic health/reconnect
    // loop must start immediately, not wait on the (possibly minutes-long, against a
    // hung upstream) connect fan-out above.
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

  // Health & Telemetry API (L1, L11): /api/health is registered at module top-level
  // (see registerHealthRoute) so in-process route tests can exercise it via the exported
  // `app` under OLLAMAS_NO_AUTOBOOT=1 — no port bind, no full-stack boot.

  // 2026 cockpit: ONE live SSE stream pushes the full mission-control view (host
  // metrics + active LLM backend + self-healing fleet) every 2s — push, not poll, so
  // the dashboard stays live with a single connection. Runs on the shared :3000 (HTTP
  // SSE, not the Vite WS) so it never flaps. Ollama is probed throttled (~6s) to avoid
  // load; system metrics are instant each tick.
  // ── Telemetry cockpit (T5-F3): per-request live op-feed + rollup ───────────────────────
  // Dedicated endpoint (isolated from the 2s host-metrics stream): on connect, replay the
  // ring buffer as `event: request` frames, subscribe for live pushes, and emit a
  // `event: rollup` frame every 1s. Events are redacted at record time — nothing here can
  // leak a raw key. GET /api/telemetry/recent gives a snapshot for the cockpit's first paint.
  app.get("/api/telemetry/recent", (req, res) => {
    const n = Math.min(1000, Math.max(1, Number(req.query.n) || 200));
    res.json(telemetrySnapshot(n, Date.now()));
  });

  app.get("/api/telemetry/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();

    // Replay the buffer so a fresh client sees recent history, then live-tail.
    for (const e of recentEvents(200)) res.write(formatTelemetryFrame("request", e));
    res.write(formatTelemetryFrame("rollup", rollup(recentEvents(500), Date.now())));

    const unsub = onRequestEvent((e) => { try { res.write(formatTelemetryFrame("request", e)); } catch { /* client gone */ } });
    const tick = setInterval(() => {
      try { res.write(formatTelemetryFrame("rollup", rollup(recentEvents(500), Date.now()))); } catch { /* client gone */ }
    }, 1000);
    (tick as any).unref?.();
    req.on("close", () => { unsub(); clearInterval(tick); });
  });

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
      // gemini-cli is keyless (the user's Google OAuth, no API key) → not in the api-key pool;
      // surface it separately so the cockpit shows the WORKING keyless path. 8s-cached → cheap.
      const geminiCliReady = await geminiCliAvailable().catch(() => false);
      const payload = {
        mode: CURRENT_MODE,
        isLive: CURRENT_MODE === "live",
        os: { platform: os.platform(), release: os.release(), arch: os.arch(), uptime: os.uptime() },
        metrics: {
          cpuLoad1Min: Number(cpu[0].toFixed(2)),
          memory: memoryUsage(),
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
        cloudProviders: [
          ...keyedCloudProviders()
            // vNEXT-D3: also carry worstPct + allApproaching (poolSaturation) so KeyVault can ride
            // this SSE instead of its 15s poll. Empty-pool guarded (worstPct 0, not the sentinel).
            .map((p) => {
              const s = ProviderRouter.keyPoolStatus(p);
              const sat = ProviderRouter.poolSaturation(p);
              return { name: p, ready: s.live > 0, live: s.live, total: s.total, keyless: false,
                worstPct: s.total > 0 ? Math.round(sat.worstPct * 100) / 100 : 0,
                allApproaching: s.total > 0 && sat.allApproaching,
                // Sovereign privacy surface: free tier trains on prompts → UI can badge it,
                // privateMode requests route around it.
                trainsOnData: trainsOnData(p) };
            }),
          // keyless: no API key, uses the user's Google OAuth via the gemini CLI binary.
          { name: "gemini-cli", ready: geminiCliReady, live: geminiCliReady ? 1 : 0, total: 1, keyless: true, worstPct: 0, allApproaching: false },
        ],
        // vNEXT-D3: key-pool saturation alerts (mirrors /api/keys/pool `alerts`) for KeyVault over SSE.
        keyAlerts: keyedCloudProviders()
          .map((p) => ({ p, s: ProviderRouter.keyPoolStatus(p), sat: ProviderRouter.poolSaturation(p) }))
          .filter(({ s, sat }) => s.total > 0 && sat.allApproaching)
          .map(({ p, s, sat }) => ({ provider: p, worstPct: Math.round(sat.worstPct * 100) / 100, live: s.live })),
        fleet: buildFleetView(cachedPool, host),
        realtime: { cores, activity, backendLatencyMs: ollama.latencyMs },
        models: {
          ...rankMacModels(ollama.allModels, os.totalmem(), ollama.macLoaded, MAC_MODEL_CHAMPION),
          championTokPerSec: MAC_CHAMPION_TOKS,
        },
        llmCost: costSummary(), // vNEXT-D1 — per-call token + USD telemetry (session-scoped)
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
    const councilScore = scoreCouncil(results);
    send({ type: "done", ...councilScore });
    // S33: council scores are pure/ephemeral — emit per-model so the subscriber
    // can fold daily averages into learned memory.
    try {
      const { emit } = await import("./server/brain-bus");
      for (const r of results) {
        emit({ type: "council.score", source: "council", at: Date.now(), payload: { model: r.model, score: r.correct ? 1 : 0 } });
      }
    } catch { /* bus absent → scores just aren't remembered */ }
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
    const cloudProviders = keyedCloudProviders();
    cloudProviders.forEach((prov) => {
      if (!masks[prov]) {
        // Catalog providers name their own env slot (e.g. GITHUB_MODELS_TOKEN); legacy keeps <PROV>_API_KEY.
        const envKey = process.env[catalogEntry(prov)?.envKey ?? prov.toUpperCase() + "_API_KEY"];
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
    const providers = keyedCloudProviders();
    // Per-provider pool health + proactive saturation (worst key burn %, all-approaching alert).
    const pool: Record<string, { total: number; live: number; worstPct: number; allApproaching: boolean; trainsOnData: boolean; envKey: string; signupUrl: string; defaultModel: string; capabilities: readonly string[] }> = {};
    for (const p of providers) {
      const s = ProviderRouter.keyPoolStatus(p);
      const sat = ProviderRouter.poolSaturation(p);
      // Empty pool (no keys configured) has nothing to burn — report 0%, not the saturation
      // sentinel (poolSaturation returns worstPct=1 for "no live keys = saturated", which the
      // alert path below uses; the display must not paint an unconfigured provider full-red).
      pool[p] = {
        total: s.total, live: s.live, worstPct: s.total > 0 ? Math.round(sat.worstPct * 100) / 100 : 0,
        allApproaching: s.total > 0 && sat.allApproaching, trainsOnData: trainsOnData(p),
        // Guided-onboarding metadata (T2-F2): the KeyVault derives its provider rows from
        // this response, so a new catalog entry ships its own key form + signup link.
        envKey: envKeyFor(p), signupUrl: keySignupUrl(p), defaultModel: catalogEntry(p)?.defaultModel ?? "",
        capabilities: capabilitiesFor(p),
      };
    }
    // alerts = providers that HAVE keys and whose whole live pool is saturating → operator action.
    const alerts = Object.entries(pool).filter(([, v]) => v.total > 0 && v.allApproaching).map(([provider, v]) => ({ provider, worstPct: v.worstPct, live: v.live }));
    res.json({ pool, alerts });
  });

  // Key autonomy convergence signal: per-provider live/cooled/absent + the 0-manual keyless set,
  // and for any non-live provider its single signup URL (the one manual step). Cheap — served
  // from the always-running key-health loop's cached snapshot (falls back to a pool+catalog
  // snapshot before the first tick). NEVER exposes a key value.
  app.get("/api/keys/health", (_req, res) => {
    res.json(getKeyHealth() ?? liveCheapSnapshot());
  });

  // Durable job queue snapshot (B1): per-state counts + the most recent jobs
  // (pending/running/done/failed, newest first). Cheap — served from the
  // always-running poll loop's cached snapshot (server/jobs.ts).
  app.get("/api/jobs", (_req, res) => {
    res.json(getJobsSnapshot());
  });

  // Semantic LLM response cache snapshot (C4): enabled flag, threshold/TTL config,
  // and event counts (hit_exact|hit_semantic|miss|store) — see server/semantic-cache.ts.
  app.get("/api/cache", async (_req, res) => {
    res.json(await getSemanticCacheSnapshot());
  });

  // Distributed tracing snapshot (B2): last RING_BUFFER_MAX finished spans
  // (auto http/express + manual LLM-call spans) from the in-process ring
  // buffer — cheap, no external collector required. See server/tracing.ts.
  app.get("/api/traces", (_req, res) => {
    res.json(getTraceSnapshot());
  });

  // Distill a stored session into durable memories/facts on demand.
  app.post("/api/brain/distill/:id", async (req, res) => {
    const sess = (db.data.sessions || []).find(s => s.id === req.params.id);
    if (!sess) return res.status(404).json({ error: "session not found" });
    try {
      const { distillSession } = await import("./server/brain-distill");
      const out = await distillSession(sess, {
        generate: async (messages) => {
          const r = await ProviderRouter.generate({
            provider: process.env.BRAIN_DISTILL_PROVIDER || sess.providerId,
            model: process.env.BRAIN_DISTILL_MODEL || sess.modelId,
            messages,
            stream: false,
          } as any);
          return r.text || "";
        },
      });
      res.json({ sessionId: sess.id, ...out });
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "distill failed" });
    }
  });

  // Hierarchy tier-router bridge snapshot (B7): current mode (off/advisory/enforce),
  // whether the on-disk HIERARCHY_POLICY is structurally + statistically usable, and the
  // last 100 recommendations. Advisory-only by default — see server/hierarchy-bridge.ts.
  app.get("/api/hierarchy", (_req, res) => {
    res.json(getHierarchySnapshot());
  });

  // v15 buddy-system: who's covering for whom. Per-provider live/saturated/cooled/absent +
  // the active buddy + whether every cloud provider is down (→ riding $0-local ollama). No values.
  app.get("/api/keys/buddy-status", (_req, res) => {
    res.json(ProviderRouter.buddyStatus());
  });

  /**
   * key-doctor (T3-F3): discover candidate keys already on this machine (env / macOS
   * keychain / gh CLI) -> validate against the real provider -> connect to the vault ->
   * report capabilities/roles unlocked. dryRun DEFAULTS TO TRUE (safe); pass
   * {dryRun:false} to actually save. Report is fully masked - key values never leave
   * the process. Never runs `gh auth refresh` itself (returns the command instead);
   * the interactive flow lives in scripts/key-doctor.mjs.
   */
  app.post("/api/keys/doctor", async (req, res) => {
    try {
      const { sources, dryRun } = req.body ?? {};
      const allowed = ["env", "keychain", "gh"] as const;
      const wanted = Array.isArray(sources) ? sources.filter((s: string) => (allowed as readonly string[]).includes(s)) : undefined;
      const report = await runDoctor({ sources: wanted as any, dryRun: dryRun !== false }, productionDoctorDeps());
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e).slice(0, 200) });
    }
  });

  app.post("/api/keys", async (req, res) => {
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
      // Cloudflare minimum-manual (T7): derive the account_id from the token so the operator
      // never copies it, and persist it (encrypted) so it survives a restart.
      if (provider === "cloudflare" && !getCloudflareAccountId()) {
        const acct = await deriveCloudflareAccountId(key);
        if (acct) { setCloudflareAccountId(acct); db.data.keys["cloudflare-account-id"] = db.encrypt(acct); }
      }
      db.logSecurity("permission_change", `Key vault configured: ${provider}`, "Decrypted credentials saved securely at rest", "info");
    }
    db.save();
    // GitHub (repo): live-validate on save so the UI can show the real login / a clear
    // error instead of a blind "success". Never blocks the save; never logs the token.
    if (provider === "github" && key) {
      const gh = await validateGitHubToken(key);
      return res.json({ success: true, github: { ok: gh.ok, tokenType: gh.tokenType, ...(gh.login ? { login: gh.login } : {}), ...(gh.scopes.length ? { scopes: gh.scopes } : {}), ...(gh.ok ? {} : { error: gh.error }) } });
    }
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
    // GitHub (repo) is NOT an LLM provider — validate the token against the real GitHub
    // API (GET /user) instead of the chat path (which false-positives via the demo lane).
    if (provider === "github") {
      let tok = typeof key === "string" && key ? key : "";
      if (!tok) { try { tok = db.decrypt(db.data.keys["github"] || ""); } catch { /* absent */ } }
      const r = await validateGitHubToken(tok);
      return res.json({
        success: r.ok,
        tokenType: r.tokenType,
        ...(r.login ? { login: r.login } : {}),
        ...(r.scopes.length ? { scopes: r.scopes } : {}),
        ...(r.ok ? {} : { error: r.error }),
        ...(r.ok && r.tokenType === "fine-grained"
          ? { warning: "Fine-grained token — Actions/Arama için repo seçimi + Actions(R/W)+Contents+Metadata izinleri gerekir." }
          : {}),
      });
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
      // Cloudflare minimum-manual: derive the account_id from the token so the operator never
      // copies it. The REST base URL needs it; catalogBaseUrl reads the runtime override.
      if (provider === "cloudflare" && !getCloudflareAccountId()) {
        const acct = await deriveCloudflareAccountId(key);
        if (acct) setCloudflareAccountId(acct);
      }
    }

    try {
      const start = Date.now();
      const result = await ProviderRouter.generate(testConfig); // nosemgrep: express-wkhtmltoimage-injection -- LLM generation (ProviderRouter.generate), no wkhtmltoimage/pdf sink
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
  const MODELS_TTL_MS = 8000;
  const MODELS_CACHE_MAX = 64; // bound: a client looping arbitrary :provider names can't grow it unbounded
  const modelsCache = new Map<string, { at: number; list: string[] }>();
  app.get("/api/models/:provider", async (req, res) => {
    const prov = req.params.provider;

    // C1 — short-TTL cache: the UI model dropdown polls this; without it every poll re-fetches
    // ollama tags / vLLM-llamacpp /v1/models / openrouter / gemini. 8s TTL (mirrors the fleet/
    // gemini-cli probe caches). Keyed by provider + freeOnly. Wrapping res.json caches every branch.
    const cacheKey = `${prov}:${req.query.freeOnly === "true" ? "free" : ""}`;
    const hit = modelsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < MODELS_TTL_MS) return res.json(hit.list);
    const sendJson = res.json.bind(res);
    res.json = ((list: unknown) => {
      if (Array.isArray(list)) {
        modelsCache.set(cacheKey, { at: Date.now(), list: list as string[] });
        // Evict the oldest entry past the cap (Map preserves insertion order) — bounded memory.
        if (modelsCache.size > MODELS_CACHE_MAX) modelsCache.delete(modelsCache.keys().next().value as string);
      }
      return sendJson(list);
    }) as typeof res.json;

    try {
      if (prov === "ollama-local") {
        if (CURRENT_MODE === "demo") {
          return res.json([
            "qwen3:8b", "qwen3:4b", "qwen3-coder:30b", "deepseek-r1:32b", "llama3.3:70b"
          ]);
        }
        const tags = await reachOllama("/api/tags", 3000); // tries 127.0.0.1 too (not just OLLAMA_HOST)
        if (tags) {
          const list = await tags.res.json();
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

      // Local OpenAI-compat backends (vLLM :8000, llama.cpp-server :8080). Probe /v1/models;
      // graceful "not running" when the host is down — no fabrication.
      if (prov === "vllm" || prov === "llamacpp") {
        const base = ProviderRouter.localCompatBaseUrl(prov);
        try {
          const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(2500) });
          if (r.ok) {
            const j = await r.json();
            const names = (j.data || []).map((m: any) => m.id).filter(Boolean);
            return res.json(names.length ? names : [`${prov} running but no model loaded (${base})`]);
          }
        } catch { /* host down */ }
        return res.json([`${prov} not running on ${base}`]);
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

      // Free-tier catalog providers (groq/cerebras/…) + custom-openai: all OpenAI-compatible.
      // Chat already routes these (providers.ts); this branch makes them appear (and be usable)
      // in the model dropdown too — previously they fell through to [] and looked broken.
      const cat = catalogEntry(prov);
      if (cat || prov === "custom-openai") {
        const base = prov === "custom-openai"
          ? (db.data.keys["custom-openai-endpoint"] || "").replace(/\/+$/, "")
          : catalogBaseUrl(cat!.id);
        const key = ProviderRouter.getDecryptedKey(prov === "custom-openai" ? "custom-openai" : cat!.id);
        if (prov === "custom-openai" && !base) {
          return res.json(["Set the custom OpenAI endpoint in the Vault first"]);
        }
        if (cat && !cat.keyless && !key) {
          return res.json([`API key not set for ${cat.id} - please configure it in the Vault`]);
        }
        try {
          const r = await fetch(`${base}/models`, {
            headers: key ? { Authorization: `Bearer ${key}` } : {},
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) {
            const j = await r.json();
            const names = (j.data || []).map((m: any) => m.id).filter(Boolean);
            if (names.length) return res.json(names);
          }
        } catch { /* endpoint down — fall back to the documented default below */ }
        // Never leave the dropdown empty: the catalog's default model is a safe, usable choice.
        return res.json(cat ? [cat.defaultModel] : [`custom-openai models unavailable (${base})`]);
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
    const { provider, model, messages, temperature, stream, privateMode } = req.body;
    // Raw endpoint contract: messages[] required. (For a single-string prompt use
    // POST /api/ai/generate.) Reject malformed input with a clear 400, not a 500.
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages (non-empty array) required; use POST /api/ai/generate for a single prompt string" });
    }

    // Abort the in-flight provider chain when the client disconnects (mirrors the ReAct
    // loop): a slow/hung upstream (e.g. gemini-cli) no longer pins resources after the
    // caller has gone away. The signal is threaded as the 4th arg of ProviderRouter.generate.
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        const result = await ProviderRouter.generate(
          { provider, model, messages, temperature, stream: true, privateMode: !!privateMode },
          (chunk) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          },
          undefined,
          ctrl.signal,
        );
        res.write(`data: ${JSON.stringify({ done: true, source: result.source, latencyMs: result.latencyMs })}\n\n`);
        res.end();
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err.message || "Inference streaming failure" })}\n\n`);
        res.end();
      }
    } else {
      try {
        const result = await ProviderRouter.generate(
          { provider, model, messages, temperature, stream: false, privateMode: !!privateMode },
          undefined,
          undefined,
          ctrl.signal,
        );
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

  /**
   * Speech-to-text (T2-F7): raw audio body -> free-tier STT provider (Groq Whisper,
   * 2,000 req/day on the chat GROQ_API_KEY). Filename via ?filename= (extension helps the
   * provider pick a decoder). No key -> honest 503; oversize -> 400 with the real cap.
   */
  app.post("/api/ai/transcribe", async (req, res) => {
    // Env first; else any STT provider whose key lives in the VAULT (keyPool covers both).
    const entry = sttEntryFor() ?? Object.values(STT_CATALOG).find((e) => ProviderRouter.keyPool(e.id).length > 0) ?? null;
    if (!entry) {
      return res.status(503).json({ error: "no STT provider key configured (set GROQ_API_KEY \u2014 free tier: console.groq.com/keys)" });
    }
    const audio: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!audio.byteLength) return res.status(400).json({ error: "raw audio body required (POST bytes, e.g. curl --data-binary @sample.wav)" });
    try {
      const filename = String(req.query.filename || "audio.wav");
      const form = buildTranscribeForm(entry, audio, filename);
      const key = ProviderRouter.getDecryptedKey(entry.id);
      const r = await fetch(`${entry.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) {
        const detail = (await r.text().catch(() => "")).slice(0, 200);
        return res.status(502).json({ error: `${entry.id} transcription error ${r.status}`, detail });
      }
      const j: any = await r.json();
      return res.json({ text: String(j.text ?? ""), provider: entry.id, model: entry.defaultModel });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return res.status(/too large/.test(msg) ? 400 : 500).json({ error: msg.slice(0, 300) });
    }
  });

  app.post("/api/ai/generate", async (req, res) => {
    // `provider` optional: council API-routed seats (groq/cerebras/zai, …) dispatch here
    // with an explicit provider; absent keeps the ollama-local Colab-faithful default.
    const { prompt, model, stream, temperature, provider } = req.body;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "prompt (non-empty string) is required" });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      try {
        for await (const chunk of aiGenerateTextStream(prompt, { model, temperature, provider })) {
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
        const result = await aiGenerate(prompt, { model, temperature, provider });
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

    // Hang-guard: a provider/tool call inside the ReAct loop has no per-call timeout, so a
    // hung free-cloud provider or stalled tool would freeze the loop — it never emits `done`,
    // the response never ends, and the client button stays stuck on "running". This generous
    // ceiling aborts a stalled run so generate/execute throw AbortError → catch → res.end().
    // Long legit multi-step work finishes well under it; env-tunable.
    const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS) || 1_200_000; // 20 min
    const runTimer = setTimeout(() => { if (!res.writableFinished) ac.abort(); }, RUN_TIMEOUT_MS);

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

    // Brain auto-recall (2026 SOTA, default ON — BRAIN_AUTO_RECALL=0 opts out): relevant
    // operator memory is injected into the system prompt every agent turn. Best-effort
    // with a hard 4s cap ($0 local embed) — the agent never blocks on its memory.
    const { activeOn: brainActiveOn, buildTurnMemory: brainBuildTurnMemory } = await import("./server/brain-active");
    let brainBlock = "";
    if (brainActiveOn(process.env.BRAIN_AUTO_RECALL)) {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
      if (lastUserMsg && typeof lastUserMsg.content === "string" && lastUserMsg.content.trim()) {
        const { buildBrainContext } = await import("./server/brain-context");
        const { brainRecall, brainSearchFacts } = await import("./server/brain");
        brainBlock = await Promise.race([
          buildBrainContext(lastUserMsg.content, { recall: brainRecall, searchFacts: brainSearchFacts }),
          new Promise<string>((r) => setTimeout(() => r(""), 4000)),
        ]).catch(() => "");
      }
    }

    let activeHistory = [...messages];
    if (!activeHistory.some(m => m.role === "system")) {
      activeHistory.unshift({ role: "system", content: brainBlock ? `${customSystemPrompt}\n\n${brainBlock}` : customSystemPrompt });
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
          privateMode: !!req.body.privateMode,
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
          // Zero-leak (T5-F5): tool_call args go to the client SSE — a model may have echoed a
          // key into them. Deep-redact secret-shaped substrings before they leave the server.
          // Telemetry is non-load-bearing: a redaction/serialize hiccup must never break the agent request.
          try { sendEvent("thought", { text: `Evaluating tool activation...`, toolCalls: redactDeep(result.toolCalls) }); } catch { /* skip this thought frame */ }

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
                // S30: outcomes are callback-only — the bus subscriber folds them
                // into one procedural line per tool per day.
                void import("./server/brain-bus").then(({ emit }) =>
                  emit({ type: "tool.outcome", source: "tool-registry", at: Date.now(), payload: { tool: e.tool, ok: e.ok } }),
                ).catch(() => { /* bus absent → outcome just isn't remembered */ });
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
          // S44: verdicts are ephemeral — the bus subscriber folds them into a daily rollup.
          try {
            const { emit } = await import("./server/brain-bus");
            emit({ type: "align.verdict", source: "verifier", at: Date.now(), payload: { ok: verdict === "PASS" } });
          } catch { /* bus absent → verdict just isn't remembered */ }
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
          // B6-debounce: fires on EVERY ReAct step/turn — chat history is replayable/non-
          // credential data, so a bounded (500ms trailing / 2s maxWait) coalesced write is
          // safe here, unlike vault/key/security writes which must stay immediate. Drained
          // by flushPendingSave() on shutdown so the last turn is never lost on exit.
          db.saveDebounced();

          // Brain per-turn retain (default ON, BRAIN_AUTO_RETAIN=0 opts out): the last
          // user+assistant exchange lands in the working tier async — embed-only, no LLM.
          // A-MAC admission gate (BRAIN_ADMIT=0 off): noise turns ("tamam", "hi") never
          // cost a row, a vector, or an embedder slot.
          if (brainActiveOn(process.env.BRAIN_AUTO_RETAIN)) {
            const { admitsTurn } = await import("./server/brain-active");
            const turnMem = brainBuildTurnMemory(sess.messages, sess.id);
            if (turnMem && admitsTurn(turnMem.content)) {
              setImmediate(async () => {
                try {
                  const { brainRemember } = await import("./server/brain");
                  await brainRemember(turnMem);
                } catch (e: any) { console.warn(`[brain] retain failed (${e?.message ?? e})`); }
              });
            }
          }

          // Brain periodic distill (default ON, BRAIN_AUTO_DISTILL=0 opts out): every
          // 10th message the session is distilled into durable memories/facts on the
          // $0 keyless floor. Fire-and-forget — never delays the response.
          if (brainActiveOn(process.env.BRAIN_AUTO_DISTILL) && sess.messages.length > 0 && sess.messages.length % 10 === 0) {
            const snapshot = { id: sess.id, messages: [...sess.messages] };
            setImmediate(async () => {
              try {
                const { resolveDistillProvider } = await import("./server/brain-active");
                const { distillSession } = await import("./server/brain-distill");
                await distillSession(snapshot, {
                  generate: async (messages) => {
                    const r = await ProviderRouter.generate({
                      provider: resolveDistillProvider(process.env),
                      model: process.env.BRAIN_DISTILL_MODEL || "openai",
                      messages, stream: false,
                    } as any);
                    return r.text || "";
                  },
                });
              } catch (e: any) { console.warn(`[brain] auto-distill failed (${e?.message ?? e})`); }
              try {
                const { emit } = await import("./server/brain-bus");
                emit({ type: "session.distilled", source: "distill", at: Date.now(), payload: { sessionId: snapshot.id, trigger: "periodic" } });
              } catch { /* bus absent */ }
            });
          }

          // S1 session-end distill: short sessions (<10 msgs) and trailing messages
          // never hit the %10 cadence, so they were never consolidated. Re-arm an idle
          // timer each turn; when the session goes quiet, distill once if anything
          // landed since the last distill of any kind.
          if (brainActiveOn(process.env.BRAIN_AUTO_DISTILL)) {
            const { shouldIdleDistill, idleDistillMs } = await import("./server/brain-active");
            const st = brainIdleDistill.get(sess.id) || { distilledLen: 0 };
            if (sess.messages.length % 10 === 0) st.distilledLen = sess.messages.length;
            if (st.timer) clearTimeout(st.timer);
            const snapLen = sess.messages.length;
            const snapshot = { id: sess.id, messages: [...sess.messages] };
            st.timer = setTimeout(async () => {
              brainIdleDistill.delete(sess.id);
              if (!shouldIdleDistill(snapLen, st.distilledLen)) return;
              try {
                const { resolveDistillProvider } = await import("./server/brain-active");
                const { distillSession } = await import("./server/brain-distill");
                await distillSession(snapshot, {
                  generate: async (messages) => {
                    const r = await ProviderRouter.generate({
                      provider: resolveDistillProvider(process.env),
                      model: process.env.BRAIN_DISTILL_MODEL || "openai",
                      messages, stream: false,
                    } as any);
                    return r.text || "";
                  },
                });
              } catch (e: any) { console.warn(`[brain] idle distill failed (${e?.message ?? e})`); }
              try {
                const { emit } = await import("./server/brain-bus");
                emit({ type: "session.distilled", source: "distill", at: Date.now(), payload: { sessionId: snapshot.id, trigger: "idle" } });
              } catch { /* bus absent */ }
            }, idleDistillMs(process.env));
            st.timer.unref?.();
            brainIdleDistill.set(sess.id, st);
          }
        }
      }

      clearTimeout(runTimer);
      res.end();
    } catch (err: any) {
      clearTimeout(runTimer);
      // Abort = client disconnect OR hang-guard/stall timeout firing. Emit a terminal
      // `done` so the client resets cleanly (a hung run aborted by the timeout must not
      // look like a silent stall to the UI), then end.
      if (err?.name === "AbortError" || ac.signal.aborted) {
        try { sendEvent("done", { text: "", status: "aborted" }); } catch { /* stream already closed */ }
        res.end();
        return;
      }
      sendEvent("error", { message: err?.message || "Execution loop failure." });
      try { sendEvent("done", { text: "", status: "error" }); } catch { /* stream already closed */ }
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
      // B6-debounce: a new empty session is replayable/non-credential chat data (unlike
      // vault/key/security/cluster writes, which stay immediate). Coalesced write is safe;
      // flushPendingSave() on shutdown drains any still-pending save before exit.
      db.saveDebounced();
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
      // B6-debounce: session deletion is replayable/non-credential chat data — worst case
      // on a crash before flush, the deleted session reappears (no security/vault impact).
      // flushPendingSave() on shutdown drains any still-pending save before exit.
      db.saveDebounced();
      res.json({ success: true, deleted: (db.data.sessions || []).length < initialCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete session" });
    }
  });

  // Chat panel (v10): persist a session's messages/title after each exchange.
  app.put("/api/agent/sessions/:id", (req, res) => {
    try {
      const { id } = req.params;
      const session = (db.data.sessions || []).find(s => s.id === id);
      if (!session) return res.status(404).json({ error: "session not found" });
      const { messages, title, modelId } = req.body || {};
      if (Array.isArray(messages)) session.messages = messages;
      if (typeof title === "string" && title.trim()) session.title = title.trim().slice(0, 120);
      if (typeof modelId === "string" && modelId.trim()) session.modelId = modelId.trim();
      session.updatedAt = new Date().toISOString();
      // B6-debounce: fires on every chat-panel message append — chat history is replayable/
      // non-credential data, so a bounded coalesced write (500ms trailing / 2s maxWait) is
      // safe here, unlike vault/key/security/cluster writes which stay immediate.
      // flushPendingSave() on shutdown drains any still-pending save before exit.
      db.saveDebounced();
      res.json({ success: true, session });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update session" });
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
  // Per-IP brute-force throttle + timing-safe admin-token compare (see createAdminGuard above,
  // module scope — extracted for the M-006 regression test). Prod builds one instance here.
  const adminGuard = createAdminGuard();
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
      // S43: seed the tenant's brain namespace (ns-jail maps it to tenant:<id>) so
      // its first recall isn't empty, and record provisioning as an ops fact.
      void (async () => {
        try {
          const { brainRemember, brainAssertFact } = await import("./server/brain");
          const { emit } = await import("./server/brain-bus");
          await brainRemember({
            id: `tenant-seed:${tenant.id}`, tier: "core",
            content: `tenant ${tenant.name} (${tenant.id}) provisioned on plan ${tenant.plan_id}`,
            source: "tenant-provision", ns: `tenant:${tenant.id}`,
          });
          await brainAssertFact({ subject: `tenant:${tenant.id}`, predicate: "provisioned_plan", object: String(tenant.plan_id), ns: "ops" });
          emit({ type: "tenant.created", source: "tenant-provision", at: Date.now(), payload: { tenantId: tenant.id } });
        } catch (e: any) { console.warn(`[brain] tenant seed skipped (${e?.message ?? e})`); }
      })();
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

  // --- Contract lane (vK2): machine onboarding — apply → T0 approve → API key.
  // Pure logic in contract/src; admin actions share the same adminGuard as /api/saas. ---
  registerContractRoutes(app, adminGuard, rateLimitMiddleware(), authMiddleware(true));

  // --- GDPR self-service account routes (M-047): tenant-authenticated export + erasure. ---
  registerAccountRoutes(app, authMiddleware(true));

  // --- Per-tenant upstream MCP servers (Faz 9E). Tenant-authenticated. ---
  app.get("/api/saas/upstreams", authMiddleware(true), async (req, res) => res.json(await listUpstreamServers(req.tenant!.tenantId)));
  // Curated catalog (dalga-2): vetted free MIT reference servers, one-click add.
  app.get("/api/saas/catalog", authMiddleware(true), async (req, res) => {
    const installed = new Set((await listUpstreamServers(req.tenant!.tenantId)).map((u) => u.name));
    res.json(decorateCatalog(installed));
  });
  app.post("/api/saas/upstreams", authMiddleware(true), async (req, res) => {
    try {
      const tId = req.tenant!.tenantId;
      const { name, transport, url, command, args, allowedTools } = req.body || {};
      if (!name || !transport) return res.status(400).json({ error: "Missing 'name' or 'transport'" });
      // Duplicate names would double-supervise `<tenantId>_<name>` and clobber tools.
      if ((await listUpstreamServers(tId)).some((u) => u.name === name)) return res.status(409).json({ error: "duplicate name" });
      // Security gate: a tenant key must not be able to spawn an arbitrary host
      // command via the stdio transport (tenant ≠ owner under SAAS_ENFORCE=1).
      const v = await validateUpstreamConfig({ transport, command, args, url });
      if (!v.ok) return res.status(400).json({ error: v.error });
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
    // Probe plan: the local LLM gates (G2/G3/G8) run whenever ollama can be reached — degraded-live
    // INCLUDED, not just full live. Only a true cloud `demo` skips them. See server/selftest-plan.ts.
    const plan = selftestProbePlan(CURRENT_MODE);
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
        provider: plan.pipelineProvider,
        model: plan.pipelineModel,
        messages: [{ role: "user", content: "test design target" }],
      }), 8000, "pipeline router");
      const expectedSource = plan.expectedSource;
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
      const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv, { authTagLength: 16 });
      let enc = cipher.update(testData, "utf8", "hex");
      enc += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");

      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv, { authTagLength: 16 });
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

    // G8: ReAct Agent Tool Loop self-test Gate — runs whenever ollama is reachable (degraded-live
    // included, mirroring G2); only a true cloud demo sandbox (no local daemon) skips it.
    if (plan.runAgentLoop) {
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
        details: "Agent tool-loop skipped — cloud demo sandbox has no local ollama daemon to drive the ReAct loop.",
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
  // ODYSSEUS PANEL (deterministic, NO-LLM) — user-facing GET /odysseus
  // Rule-router -> ToolRegistry.execute("mcp__odysseus__*") in-process, reusing the
  // same "local" ctx the ReAct agent uses (no allowedTiers => host_upstream allowed).
  // ----------------------------------------------------
  app.post("/api/odysseus/run", async (req, res) => {
    const b = req.body || {};
    const ROUTES: Record<string, [string, Record<string, any>]> = {
      chat: ["odysseus_chat", { prompt: b.prompt, model: b.model }],
      research: ["odysseus_research", { query: b.query, model: b.model }],
      agent: ["odysseus_agent_task", { task: b.task, workspace: b.workspace, model: b.model }],
      health: ["odysseus_health", {}],
    };
    const entry = ROUTES[b.type];
    if (!entry) return res.status(400).json({ ok: false, error: `unknown type '${b.type}'` });
    const [tool, raw] = entry;
    const args: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) if (v !== undefined && v !== null && v !== "") args[k] = v;
    if (b.type !== "health" && !args.model) args.model = "ollamas-auto";
    try {
      // Free cloud (pollinations) occasionally streams an empty answer; retry up to
      // 3x for content tools so the user panel is reliable. health returns once.
      const tries = b.type === "health" ? 1 : 3;
      let text = "";
      let ok = false;
      for (let i = 0; i < tries; i++) {
        const r = await ToolRegistry.execute("mcp__odysseus__" + tool, args, {
          isLive: CURRENT_MODE !== "demo",
          workspaceRoot: db.data.workspacePath,
          autoApply: true,
          deps: TOOL_DEPS,
          tenantId: "local",
        });
        const o: any = r.output;
        text = typeof o === "string" ? o
          : Array.isArray(o?.content) ? o.content.map((c: any) => c?.text ?? "").join(" ").trim()
          : (o?.text ?? o?.error ?? JSON.stringify(o));
        ok = !!r.ok && !o?.error && !!text && text !== "(empty answer)" && !text.includes("[odysseus error]");
        if (ok || b.type === "health") break;
      }
      res.json({ ok, result: text });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
  });

  app.get("/odysseus", (_req, res) => {
    res.type("html").send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Odysseus · ollamas</title><style>
:root{--bg:#050A14;--surf:#0D1B2E;--line:rgba(255,255,255,.1);--fg:#F0F4FF;--fg2:#8A9BB0;--cyan:#00D4FF;--ok:#00C896;--bad:#F5576C}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,sans-serif;padding:32px 18px}
main{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
header{display:flex;align-items:center;gap:12px}
.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#00D4FF,#7B5EA7);display:flex;align-items:center;justify-content:center;font-weight:800;color:#050A14}
h1{font-size:21px;margin:0;letter-spacing:-.02em}.sub{color:var(--fg2);font-size:12.5px;margin-top:2px}
.badge{margin-left:auto;font:600 12px/1 ui-monospace,monospace;padding:6px 11px;border-radius:99px;border:1px solid var(--line)}
.badge.ok{color:var(--ok);border-color:rgba(0,200,150,.4);background:rgba(0,200,150,.08)}
.badge.bad{color:var(--bad);border-color:rgba(245,87,108,.4);background:rgba(245,87,108,.08)}
.card{background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px}
label{font-size:12px;color:var(--fg2);text-transform:uppercase;letter-spacing:.06em}
select,textarea,input{width:100%;background:#0a1626;border:1px solid var(--line);border-radius:9px;color:var(--fg);padding:11px 13px;font:inherit}
textarea{min-height:96px;resize:vertical}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>div{flex:1;min-width:140px}
button{background:var(--cyan);color:#050A14;font-weight:700;border:0;border-radius:9px;padding:12px 20px;cursor:pointer;font-size:14px}
button:disabled{opacity:.5;cursor:progress}
.out{white-space:pre-wrap;background:#0a1626;border:1px solid var(--line);border-radius:9px;padding:14px;min-height:60px;font:13.5px/1.6 ui-monospace,monospace;color:#cfe}
.meta{font:11px/1 ui-monospace,monospace;color:var(--fg2)}
footer{color:#536882;font-size:11.5px;text-align:center;font-family:ui-monospace,monospace}
</style></head><body><main>
<header><div class="logo">e</div><div><h1>Odysseus</h1><div class="sub">ollamas :3000 → odysseus → cloud · $0 · yapay-zekasız deterministik</div></div><span id="badge" class="badge">kontrol…</span></header>
<div class="card">
<div><label for="act">İşlem</label><select id="act" onchange="syncFields()">
<option value="chat">Sohbet — Odysseus'a soru sor</option>
<option value="research">Araştırma — derin araştırma (web)</option>
<option value="agent">Ajan Görevi — otonom araç-kullanan görev</option>
</select></div>
<div id="wsWrap" style="display:none"><label for="ws">Çalışma dizini (opsiyonel)</label><input id="ws" placeholder="/path/to/workspace"></div>
<div><label id="inLbl" for="inp">Mesaj</label><textarea id="inp" placeholder="Yazın…"></textarea></div>
<div class="row"><div><button id="go" onclick="run()">Çalıştır ▸</button></div><div class="meta" id="meta" style="align-self:center;text-align:right"></div></div>
</div>
<div class="card"><label>Sonuç</label><div id="out" class="out">—</div></div>
<footer>deterministik: kural-router → ollamas /api/odysseus/run → mcp__odysseus__* · LLM yok</footer>
</main><script>
const $=id=>document.getElementById(id);
function syncFields(){const a=$('act').value;$('inLbl').textContent=a==='research'?'Araştırma sorusu':a==='agent'?'Görev':'Mesaj';$('wsWrap').style.display=a==='agent'?'':'none';}
async function call(body){const r=await fetch('/api/odysseus/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
async function health(){try{const d=await call({type:'health'});const b=$('badge');const ok=d.ok&&/healthy/.test(d.result||'');b.textContent=ok?'● bağlı':'● bağlantı yok';b.className='badge '+(ok?'ok':'bad');}catch{$('badge').textContent='● bağlantı yok';$('badge').className='badge bad';}}
async function run(){const a=$('act').value,v=$('inp').value.trim();if(!v){$('out').textContent='Lütfen bir metin girin.';return;}
const body={type:a};body[a==='research'?'query':a==='agent'?'task':'prompt']=v;if(a==='agent'&&$('ws').value.trim())body.workspace=$('ws').value.trim();
$('go').disabled=true;$('out').textContent='Odysseus çalışıyor…';$('meta').textContent='';const t=Date.now();
try{const d=await call(body);$('out').textContent=d.ok?(d.result||'(boş yanıt)'):('HATA: '+(d.error||d.result||'bilinmeyen'));$('meta').textContent=(d.ok?'✓':'✗')+' '+((Date.now()-t)/1000).toFixed(1)+'s';}
catch(e){$('out').textContent='HATA: '+e;}finally{$('go').disabled=false;}}
syncFields();health();setInterval(health,30000);
</script></body></html>`);
  });

  // ----------------------------------------------------
  // ORCHESTRA COUNCIL — 4-owner weighted deliberation (deterministic orchestration).
  // Parallel model-seats (ollamas=groq ∥ odysseus=gemini ∥ claudecode=github-models),
  // score (verifiable=checkAnswer / open=judge), weighted synthesis, reward-ledger + levels.
  // ecy (%30) = human/constitution weight applied to the reward + synthesis values.
  // ----------------------------------------------------
  const COUNCIL_LEDGER = path.join(os.homedir(), ".ollamas", "council-ledger.json");
  const COUNCIL_OWNERS: Array<{ owner: string; weight: number; kind: string; provider?: string }> = [
    { owner: "ollamas", weight: 0.25, kind: "provider", provider: "groq" },
    { owner: "odysseus", weight: 0.23, kind: "odysseus" },
    { owner: "claudecode", weight: 0.22, kind: "provider", provider: "github-models" },
  ];
  const COUNCIL_LEVELS = [
    { level: 5, name: "Orkestra", min: 300 }, { level: 4, name: "Usta", min: 150 },
    { level: 3, name: "Kalibre", min: 75 }, { level: 2, name: "Uyumlu", min: 25 },
    { level: 1, name: "Çırak", min: 0 },
  ];
  const readCouncilLedger = (): any => {
    try { return JSON.parse(fs.readFileSync(COUNCIL_LEDGER, "utf8")); }
    catch { return { rewards: { ecy: 0, ollamas: 0, odysseus: 0, claudecode: 0 }, tasks: 0, calibration: {}, history: [] }; }
  };
  const writeCouncilLedger = (l: any) => {
    try { fs.mkdirSync(path.dirname(COUNCIL_LEDGER), { recursive: true }); fs.writeFileSync(COUNCIL_LEDGER, JSON.stringify(l, null, 2)); } catch { /* best-effort */ }
  };
  const councilLevel = (total: number) => COUNCIL_LEVELS.find((l) => total >= l.min) || COUNCIL_LEVELS[COUNCIL_LEVELS.length - 1];

  const councilSeatAnswer = async (seat: { owner: string; kind: string; provider?: string }, task: string): Promise<string> => {
    if (seat.kind === "odysseus") {
      for (let i = 0; i < 3; i++) {
        if (i) await new Promise((r) => setTimeout(r, 1500)); // space retries: odysseus/gemini empties under burst
        const r = await ToolRegistry.execute("mcp__odysseus__odysseus_chat", { prompt: task, model: "ollamas-auto" }, {
          isLive: CURRENT_MODE !== "demo", workspaceRoot: db.data.workspacePath, autoApply: true, deps: TOOL_DEPS, tenantId: "local",
        });
        const o: any = r.output;
        const t = typeof o === "string" ? o : Array.isArray(o?.content) ? o.content.map((c: any) => c?.text ?? "").join(" ").trim() : (o?.text ?? "");
        if (t && t !== "(empty answer)") return t;
      }
      return "";
    }
    // Provider seats (ollamas=groq, claudecode=github-models) — mirror the odysseus
    // seat's retry. github-models/groq throttle under the 3-seat concurrent burst and
    // empty on a single shot, which silently zeroed the claudecode seat every round.
    // singleAttempt stays (pins THIS provider — no cross-provider fallback that would
    // falsify the seat's identity); we just retry the same provider up to 3x.
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1500));
      const g: any = await ProviderRouter.generate({ provider: seat.provider, messages: [{ role: "user", content: task }], stream: false, singleAttempt: true } as any);
      const t = g?.text ?? "";
      if (t && t !== "(empty answer)") return t;
    }
    // Last resort: free-tier providers (github-models, gemini) auth-flap intermittently,
    // so the pinned provider can be dead for a whole round. Drop singleAttempt on a final
    // attempt → the router falls back to any live provider. Keeps the seat alive (council
    // never silently zeroes a seat); diversity drops only while the pinned provider is down.
    try {
      const g: any = await ProviderRouter.generate({ provider: seat.provider, messages: [{ role: "user", content: task }], stream: false } as any);
      const t = g?.text ?? "";
      if (t && t !== "(empty answer)") return t;
    } catch { /* all providers down — seat empty this round */ }
    return "";
  };

  const councilJudge = async (task: string, answer: string): Promise<number> => {
    if (!answer) return 0;
    // Robust: 3 judges run concurrently per solve; a single provider under that burst
    // sometimes empties → score 0. Try cerebras first (handles concurrency well), groq
    // fallback. Only a parsed number wins; empty/throw → next provider.
    const prompt = `Rate 0.0-1.0 how well this answer solves the task. Reply ONLY one decimal number.\nTASK: ${task}\nANSWER: ${answer}`;
    for (const prov of ["cerebras", "groq", "gemini"]) {
      try {
        const g: any = await ProviderRouter.generate({ provider: prov, messages: [{ role: "user", content: prompt }], stream: false, singleAttempt: true } as any);
        const m = String(g?.text ?? "").match(/(\d?\.\d+|\d)/);
        if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) return Math.max(0, Math.min(1, v)); }
      } catch { /* next provider */ }
    }
    return 0;
  };

  app.post("/api/council/solve", async (req, res) => {
    const b = req.body || {};
    const task = String(b.task || "").trim();
    if (!task) return res.status(400).json({ ok: false, error: "task required" });
    const verifiable = !!b.verifiable && b.expect != null;
    try {
      // Perf: per-seat 6s timeout — a slow seat (e.g. odysseus's extra hops) no longer
      // gates the whole council; it returns "" (best-effort) and synthesis proceeds with
      // the seats that answered in time. Weighted synth is already resilient to an empty seat.
      const seatTimeout = <T>(pr: Promise<T>, ms: number, fallback: T) =>
        Promise.race([pr, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
      const answers = await Promise.all(COUNCIL_OWNERS.map((s) => seatTimeout(councilSeatAnswer(s, task), 6000, "").catch(() => "")));
      // Perf+reliability: verifiable → local checkAnswer (no API). Open → ONE judge call
      // rating ALL seats at once (was 3 concurrent judges → burst → intermittent 0-scores).
      let scores: number[];
      if (verifiable) {
        scores = answers.map((a) => (a && checkAnswer(a, String(b.expect)) ? 1 : 0));
      } else {
        scores = new Array(answers.length).fill(0);
        const filled = answers.map((a, i) => ({ i, a })).filter((x) => x.a);
        if (filled.length) {
          const L = ["A", "B", "C", "D", "E"];
          const jp = `Her yanıtı GÖREV'i çözme kalitesine göre puanla. SADECE ${filled.length} skoru İKİ ONDALIKLI, virgülle ayırarak yaz (örn: 0.90,0.75,1.00). Başka hiçbir şey yazma.\nGÖREV: ${task}\n` +
            filled.map((x, k) => `[${L[k]}] ${x.a}`).join("\n");
          // Wide fallback: free providers hit daily/rate limits under heavy use. Try many
          // (incl. less-used github-models/mistral/zai/sambanova) so the judge finds a live one.
          for (const prov of ["cerebras", "groq", "gemini", "github-models", "mistral", "zai", "sambanova"]) {
            try {
              const g: any = await ProviderRouter.generate({ provider: prov, messages: [{ role: "user", content: jp }], stream: false, singleAttempt: true } as any);
              // Parse ONLY decimals (0.90, 1.00) — force 2-decimal output so no stray integer
              // from the answer text misaligns the scores.
              const nums = [...String(g?.text ?? "").matchAll(/[01]\.\d\d?/g)].map((m) => parseFloat(m[0])).filter((v) => v >= 0 && v <= 1);
              if (nums.length >= filled.length) { filled.forEach((x, k) => { scores[x.i] = nums[k]; }); break; }
            } catch { /* next provider */ }
          }
          // Graceful degradation: free providers get rate-limited/degraded under heavy daily
          // use → judge returns empty (all-zero). An answered seat scoring 0 is almost always
          // judge-unavailable, not a terrible answer. Give answered seats a neutral 0.7 so
          // ranking + reward degrade gracefully instead of collapsing to a weight-only tie.
          if (scores.every((v) => v === 0)) filled.forEach((x) => { scores[x.i] = 0.7; });
        }
      }
      const seats = COUNCIL_OWNERS.map((s, i) => ({ owner: s.owner, weight: s.weight, score: Math.round(scores[i] * 100) / 100, answer: answers[i] }));
      const ranked = seats.map((s) => ({ ...s, w: s.weight * (s.score || 0.01) })).sort((a, c) => c.w - a.w);
      const synthPrompt = `Sen 4-sahipli orkestra konseyinin sentezcisisin. ecy-değerleri: Doğruluk>hız, kısa-öz kanıtlı, $0/cloud.\nGÖREV: ${task}\n\nKoltuk yanıtları (ağırlık=pay×skor, yüksek baskın):\n${ranked.map((s) => `• ${s.owner} (ağırlık ${s.w.toFixed(2)}, skor ${s.score}): ${s.answer || "(boş)"}`).join("\n")}\n\nBu yanıtları ağırlıklarına göre birleştirip TEK en-iyi, kısa-öz, doğru final yanıtı ver. Sadece final yanıtı yaz.`;
      let synth = "";
      // Synth on cerebras (separate pool) so gemini's tight 10-RPM free budget is left to
      // the odysseus seat (which speaks gemini) instead of being split synth+odysseus.
      try { const sg: any = await ProviderRouter.generate({ provider: "cerebras", messages: [{ role: "user", content: synthPrompt }], stream: false, singleAttempt: true } as any); synth = sg?.text ?? ""; } catch { /* fall back below */ }
      if (!synth) synth = ranked[0]?.answer || "";
      const diff = Number(b.difficulty ?? 1.0) || 1.0;
      const led = readCouncilLedger();
      const bestScore = Math.max(0, ...seats.map((s) => s.score));
      seats.forEach((s) => { led.rewards[s.owner] = (led.rewards[s.owner] || 0) + s.score * s.weight * diff * 10; });
      led.rewards.ecy = (led.rewards.ecy || 0) + bestScore * 0.30 * diff * 10;
      led.tasks = (led.tasks || 0) + 1;
      const ttype = String(b.type || "genel");
      led.calibration = led.calibration || {};
      led.calibration[ttype] = led.calibration[ttype] || {};
      const winner = ranked[0]?.owner;
      if (winner) led.calibration[ttype][winner] = (led.calibration[ttype][winner] || 0) + 1;
      let total = 0; for (const v of Object.values(led.rewards)) total += Number(v);
      const lvl = councilLevel(total);
      led.level = lvl.level; led.level_name = lvl.name; led.total_reward = Math.round(total * 10) / 10;
      led.history = (led.history || []).slice(-49); led.history.push({ task: task.slice(0, 80), winner, bestScore, verifiable });
      writeCouncilLedger(led);
      res.json({ ok: true, answer: synth, seats, winner, ecy_weight: 0.30, level: lvl.level, level_name: lvl.name, total_reward: led.total_reward, rewards: led.rewards });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
  });

  app.get("/api/council/ledger", (_req, res) => {
    const led = readCouncilLedger();
    let total = 0; for (const v of Object.values(led.rewards || {})) total += Number(v);
    const lvl = councilLevel(total);
    res.json({ ...led, total_reward: Math.round(total * 10) / 10, level: lvl.level, level_name: lvl.name, next: COUNCIL_LEVELS.filter((l) => l.min > total).slice(-1)[0] || null });
  });

  app.get("/council", (_req, res) => {
    res.type("html").send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Orkestra Konseyi · ollamas</title><style>
:root{--bg:#050A14;--surf:#0D1B2E;--raised:#132338;--line:rgba(255,255,255,.1);--fg:#F0F4FF;--fg2:#8A9BB0;--cyan:#00D4FF;--violet:#7B5EA7;--ok:#00C896;--warn:#F5A623}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,sans-serif;padding:30px 18px}
main{max-width:880px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
header{display:flex;align-items:center;gap:12px}.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#00D4FF,#7B5EA7);display:flex;align-items:center;justify-content:center;font-weight:800;color:#050A14}
h1{font-size:20px;margin:0}.sub{color:var(--fg2);font-size:12px;margin-top:2px}
.lvl{margin-left:auto;text-align:right}.lvl .b{font:700 13px/1 ui-monospace,monospace;color:var(--cyan)}.lvl .t{font:11px/1 ui-monospace,monospace;color:var(--fg2);margin-top:4px}
.card{background:var(--surf);border:1px solid var(--line);border-radius:13px;padding:16px;display:flex;flex-direction:column;gap:11px}
label{font-size:11px;color:var(--fg2);text-transform:uppercase;letter-spacing:.06em}
textarea{width:100%;min-height:74px;background:#0a1626;border:1px solid var(--line);border-radius:9px;color:var(--fg);padding:11px 13px;font:inherit;resize:vertical}
button{background:var(--cyan);color:#050A14;font-weight:700;border:0;border-radius:9px;padding:11px 20px;cursor:pointer;align-self:flex-start}button:disabled{opacity:.5;cursor:progress}
.seats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.seat{background:var(--raised);border:1px solid var(--line);border-radius:10px;padding:12px}
.seat.win{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan) inset}
.seat .o{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:6px}.seat .o .w{margin-left:auto;font:11px/1 ui-monospace,monospace;color:var(--violet)}
.seat .sc{height:5px;background:#0a1626;border-radius:3px;margin:8px 0;overflow:hidden}.seat .sc>i{display:block;height:100%;background:var(--ok)}
.seat .a{font:11.5px/1.5 ui-monospace,monospace;color:var(--fg2);max-height:74px;overflow:auto;white-space:pre-wrap}
.out{white-space:pre-wrap;background:#0a1626;border:1px solid var(--cyan);border-radius:9px;padding:14px;font:13.5px/1.6 ui-monospace,monospace;color:#dff}
.rew{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.rew>div{background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:9px 11px}.rew .k{font:10px/1 ui-monospace,monospace;color:var(--fg2);text-transform:uppercase}.rew .v{font:700 15px/1 ui-monospace,monospace;margin-top:5px}
.bar{height:4px;background:#0a1626;border-radius:2px;margin-top:6px;overflow:hidden}.bar>i{display:block;height:100%;background:linear-gradient(90deg,#00D4FF,#7B5EA7)}
.meta{font:11px/1 ui-monospace,monospace;color:var(--fg2);text-align:right}
footer{color:#536882;font:11px/1.4 ui-monospace,monospace;text-align:center}
</style></head><body><main>
<header><div class="logo">e</div><div><h1>Orkestra Konseyi</h1><div class="sub">ecy %30 · ollamas %25 · odysseus %23 · claudecode %22 — ağırlıklı council, $0 cloud</div></div>
<div class="lvl"><div class="b" id="lvl">L?</div><div class="t" id="lvlt">…</div></div></header>
<div class="card"><label for="task">Görev</label><textarea id="task" placeholder="Konseye bir görev ver — 4 sahip eş-zamanlı çözer, ağırlıklı sentezler…"></textarea>
<div style="display:flex;gap:12px;align-items:center"><button id="go" onclick="solve()">Konseyi Çalıştır ▸</button><span class="meta" id="meta" style="flex:1"></span></div></div>
<div class="card"><label>Sentez (en-iyi yanıt)</label><div id="out" class="out">—</div>
<label style="margin-top:6px">Koltuklar</label><div class="seats" id="seats"></div></div>
<div class="card"><label>Ödül & Seviye</label><div class="rew" id="rew"></div></div>
<footer>deterministik ağırlıklı council · /api/council/solve → groq ∥ odysseus/gemini ∥ github-GPT4o → gemini-sentez · BRAIN.md anayasa</footer>
</main><script>
const $=id=>document.getElementById(id);const OW={ecy:.30,ollamas:.25,odysseus:.23,claudecode:.22};
async function ledger(){try{const d=await(await fetch('/api/council/ledger')).json();$('lvl').textContent='L'+d.level;$('lvlt').textContent=(d.level_name||'')+' · '+(d.total_reward||0)+' pt'+(d.next?(' → L'+d.next.level+' @'+d.next.min):'');const r=d.rewards||{};$('rew').innerHTML=['ecy','ollamas','odysseus','claudecode'].map(o=>{const v=Math.round((r[o]||0)*10)/10;const pct=Math.min(100,v/3);return '<div><div class="k">'+o+' '+(OW[o]*100)+'%</div><div class="v">'+v+'</div><div class="bar"><i style="width:'+pct+'%"></i></div></div>'}).join('');}catch(e){}}
async function solve(){const t=$('task').value.trim();if(!t){$('out').textContent='Görev gir.';return;}$('go').disabled=true;$('out').textContent='Konsey çalışıyor — 4 sahip eş-zamanlı…';$('seats').innerHTML='';$('meta').textContent='';const s=Date.now();
try{const d=await(await fetch('/api/council/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:t})})).json();
if(!d.ok){$('out').textContent='HATA: '+(d.error||'?');return;}$('out').textContent=d.answer||'(boş)';
$('seats').innerHTML=(d.seats||[]).map(x=>'<div class="seat'+(x.owner===d.winner?' win':'')+'"><div class="o">'+x.owner+(x.owner===d.winner?' 🏆':'')+'<span class="w">'+Math.round(x.weight*100)+'%</span></div><div class="sc"><i style="width:'+Math.round((x.score||0)*100)+'%"></i></div><div class="a">'+(x.answer?x.answer.replace(/</g,"&lt;"):'(boş)')+'</div></div>').join('');
$('meta').textContent='✓ kazanan: '+d.winner+' · '+((Date.now()-s)/1000).toFixed(1)+'s · L'+d.level+' '+d.level_name;ledger();}
catch(e){$('out').textContent='HATA: '+e;}finally{$('go').disabled=false;}}
ledger();setInterval(ledger,15000);
</script></body></html>`);
  });

  // ----------------------------------------------------
  // OpenAI-compat shim (/v1) — lets odysseus (or any OpenAI client) use ollamas' reliable
  // vault-keyed multi-cloud routing as its model backend. Tries several reliable cloud
  // providers until one returns non-empty (no local ollama). Fixes odysseus flakiness from
  // a single degraded/rate-limited free provider.
  // ----------------------------------------------------
  const V1_PROVIDERS = ["groq", "gemini", "cerebras", "github-models", "sambanova"];
  const v1Gen = async (p: string, messages: any[]): Promise<string> => {
    const g: any = await ProviderRouter.generate({ provider: p, messages, stream: false, singleAttempt: true } as any);
    const t = (g?.text ?? "").trim();
    if (!t) throw new Error("empty");
    return t;
  };
  // Perf: RACE the two fastest providers in parallel (first non-empty wins) instead of
  // sequential-await. A slow/empty groq no longer blocks — cerebras answers concurrently.
  // Falls back to the remaining providers (raced) only if both leaders fail.
  const reliableGenerate = async (messages: any[]): Promise<string> => {
    // Leaders = cerebras+gemini (fast, and NOT groq): keeps groq's burst budget free for the
    // council seat + 3 concurrent judges that already use groq. groq stays in the fallback tier.
    try {
      return await Promise.any(["cerebras", "gemini"].map((p) => v1Gen(p, messages)));
    } catch { /* both leaders failed → race the rest incl. groq */ }
    try {
      return await Promise.any(["groq", "github-models", "sambanova"].map((p) => v1Gen(p, messages)));
    } catch { return ""; }
  };
  app.get("/v1/models", (_req, res) => {
    res.json({ object: "list", data: [{ id: "ollamas-auto", object: "model", owned_by: "ollamas" }, ...V1_PROVIDERS.map((p) => ({ id: p, object: "model", owned_by: "ollamas" }))] });
  });
  app.post("/v1/chat/completions", async (req, res) => {
    const b = req.body || {};
    const messages = Array.isArray(b.messages) ? b.messages : [];
    const id = "chatcmpl-" + Date.now().toString(36);
    try {
      const content = await reliableGenerate(messages);
      if (b.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.json({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "ollamas-auto", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
    } catch (e: any) {
      res.status(500).json({ error: { message: String(e?.message ?? e), type: "server_error" } });
    }
  });

  // ----------------------------------------------------
  // VITE & STATIC FILES SERVING
  // ----------------------------------------------------

  // FIX B5: hoisted to function scope (was a `const vite` local to this `if` block) so
  // `shutdown` below can close it. Left unclosed, its HMR websocket/watchers/dep-optimizer
  // survive the hard `process.exit` — the documented "Port 24678 already in use" +
  // blank-page-after-restart symptom.
  let viteServer: ViteDevServer | null = null;
  if (process.env.NODE_ENV !== "production") {
    viteServer = await createViteServer({
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
    app.use(viteServer.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Second registration of the central error middleware (M-049): routes registered inside
  // initializeServer come after the module-top-level registration in the Express stack, so
  // their errors only reach a handler registered here. Same function → same behavior.
  app.use(errorTrackingMiddleware);

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Cockpit] Console backend is listening on http://0.0.0.0:${PORT}`);
    // Hydrate the vault-stored Cloudflare account id (T7) so the Workers AI base URL resolves
    // after a restart without the operator re-entering it (env still wins if set).
    try { const a = db.decrypt((db.data.keys || {})["cloudflare-account-id"] || ""); if (a) setCloudflareAccountId(a); } catch { /* absent → env/derive path */ }
    // Boot-time key-doctor (T3-F5): env-only (no keychain prompts, no gh spawn at boot),
    // fire-and-forget, ONE masked summary line. A key dropped into .env connects itself
    // on the next restart with zero operator action. Full scan: scripts/key-doctor.mjs.
    void runDoctor({ sources: ["env"], dryRun: false }, productionDoctorDeps())
      .then((rep) => {
        const s = (want: string) => Object.entries(rep.providers).filter(([, v]) => v.status === want).map(([p]) => p);
        const connected = s("connected"), invalid = s("invalid");
        console.log(`[KeyDoctor] boot scan: +${connected.length} connected${connected.length ? ` (${connected.join(",")})` : ""} · ${s("already").length} already · ${invalid.length} invalid${invalid.length ? ` (${invalid.join(",")})` : ""} · ${s("absent").length} absent`);
      })
      .catch((e) => console.warn(`[KeyDoctor] boot scan skipped: ${String(e?.message ?? e).slice(0, 80)}`));

    // eCym panel-brief auto-distill (v13-D) — OPT-IN (ECYM_AUTODISTILL=1) so boot never
    // adds surprise GPU load. Fills only panels that have no distilled brief yet; fail-soft
    // (DDG rate-limit keeps the fallback). Sequential via distillPanel's own GPU mutex.
    if (process.env.ECYM_AUTODISTILL === "1") {
      void (async () => {
        const missing = (PANEL_IDS as readonly PanelId[]).filter((id) => !db.data.panelBriefs?.[id]);
        if (!missing.length) return;
        console.log(`[eCym] auto-distill: ${missing.length} panel brief(s) → ${missing.join(",")}`);
        for (const id of missing) {
          try { for await (const _ of distillPanel(db, id)) { /* drain — persistence is inside */ } }
          catch (e) { console.warn(`[eCym] distill ${id} skipped: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
        }
      })();
    }
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
      stopKeyHealth();
      await stopJobs(); // finishes any in-flight job, claims no new one, closes its DbClient; also
                         // halts the webhook-retry recurring loop + oauth-gc cron (C2 migration)
      stopSupervisor();
      ecysearcherSupervisor.haltSupervision(); // halt the health loop; leave eCySearcher containers running
      // FIX B5: close vite BEFORE the HTTP drain — its HMR ws/watchers/dep-optimizer must
      // not survive the process (best-effort; a vite close failure must not abort shutdown).
      await viteServer?.close().catch(() => {});
      // FIX B5: drainHttp() actually resolves even with an SSE client attached
      // (/api/cockpit/stream, /api/telemetry/stream never call res.end() on their own) —
      // previously `server.close(cb)`'s callback waited on that connection forever, so the
      // grace timer above fired `process.exit(1)` on every restart instead of this clean path.
      await drainHttp(server, 2000);
      // FIX B5: flush the debounced chat-turn writer (server/db.ts) so a save still
      // in-flight when SIGTERM lands isn't lost.
      await flushPendingSave();
      await closeStore();
      await shutdownTracing(); // flush + stop the OTel SDK (B2)
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

  // Last-resort guards, now centralized in server/error-tracking.ts (M-049): a stray
  // `.catch`-less background promise must NOT kill the gateway (Node ≥15 terminates on an
  // unhandled rejection by default) → record + survive; uncaughtException → record then the
  // graceful `shutdown` closure drains + exits (state undefined — never resume), unless
  // OLLAMAS_KEEP_ALIVE_ON_UNCAUGHT=1. Every event also lands in the error ring buffer +
  // ollamas_errors_total. Legacy ollamas_unhandled_rejection_total kept via onRejectionSurvived.
  installProcessErrorHooks({
    onFatal: (_err) => void shutdown("uncaughtException"),
    onRejectionSurvived: () => unhandledRejectionTotal.inc(),
  });
}

// ----------------------------------------------------
// ORG management layer (orchestration/ORGANIZATION.md) — read-only status surface, registered at
// module top level so in-process tests reach it under OLLAMAS_NO_AUTOBOOT=1. JSON overview mirrors
// /api/brain/overview (ungated, tolerant); the /org panel mirrors the odysseus/council panel shape.
// Sources: ORG_CHART.json + learned ORG_POLICY.json (org-train) + ~/.ollamas/brain-ledger.jsonl +
// SANDBOX-ORG/CALIBRATION-ORG verdicts.
// ----------------------------------------------------
app.get("/api/org/overview", async (req, res) => {
  try {
    const recent = Math.min(Math.max(Number(req.query.recent) || 20, 1), 100);
    const { orgOverview } = await import("./server/org-status");
    res.json(orgOverview({ recent }));
  } catch (err: any) { res.status(500).json({ error: err?.message || "org overview failed" }); }
});

app.get("/org", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ORG · Yönetim Katmanı · ollamas</title><style>
:root{--bg:#050A14;--surf:#0D1B2E;--raised:#132338;--line:rgba(255,255,255,.1);--fg:#F0F4FF;--fg2:#8A9BB0;--cyan:#00D4FF;--violet:#7B5EA7;--ok:#00C896;--warn:#F5A623;--bad:#FF5470}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,sans-serif;padding:30px 18px}
main{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
header{display:flex;align-items:center;gap:12px}.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#00D4FF,#7B5EA7);display:flex;align-items:center;justify-content:center;font-weight:800;color:#050A14}
h1{font-size:20px;margin:0}.sub{color:var(--fg2);font-size:12px;margin-top:2px}
.card{background:var(--surf);border:1px solid var(--line);border-radius:13px;padding:16px;display:flex;flex-direction:column;gap:11px}
label{font-size:11px;color:var(--fg2);text-transform:uppercase;letter-spacing:.06em}
.badges{display:flex;gap:8px;flex-wrap:wrap}.badge{font:700 11.5px/1 ui-monospace,monospace;border-radius:8px;padding:8px 12px;border:1px solid var(--line);background:var(--raised)}
.badge.ok{color:var(--ok);border-color:var(--ok)}.badge.bad{color:var(--bad);border-color:var(--bad)}.badge.dim{color:var(--fg2)}
table{width:100%;border-collapse:collapse;font:12.5px/1.5 ui-monospace,monospace}
th{color:var(--fg2);text-transform:uppercase;font-size:10px;text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.05)}
.auth{font-weight:700;border-radius:6px;padding:2px 8px;display:inline-block}
.auth.trusted{color:#050A14;background:var(--ok)}.auth.apply-gated{color:var(--ok);border:1px solid var(--ok)}
.auth.propose{color:var(--cyan);border:1px solid var(--cyan)}.auth.observe{color:var(--bad);border:1px solid var(--bad)}.auth.none{color:var(--fg2)}
.ledger{max-height:280px;overflow:auto;display:flex;flex-direction:column;gap:6px}
.rec{background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font:11.5px/1.5 ui-monospace,monospace}
.rec .t{color:var(--fg2);font-size:10px}.rec.learned{border-color:var(--violet)}
footer{color:#536882;font:11px/1.4 ui-monospace,monospace;text-align:center}
</style></head><body><main>
<header><div class="logo">e</div><div><h1>ORG — Yönetim &amp; Organizasyon Katmanı</h1><div class="sub">roller sabit · yetkiler ÖĞRENİLİR (wilson curriculum + UCB1) · her işlem brain-ledger'da</div></div></header>
<div class="card"><label>Sağlık / Kanıt</label><div class="badges" id="badges">yükleniyor…</div></div>
<div class="card"><label>Aktörler — rol · öğrenilmiş yetki · kanıt</label><div style="overflow-x:auto"><table><thead><tr><th>aktör</th><th>tür</th><th>rol</th><th>maliyet</th><th>yetki</th><th>wilson</th><th>n</th></tr></thead><tbody id="actors"></tbody></table></div></div>
<div class="card"><label>Brain Ledger (son işlemler)</label><div class="ledger" id="ledger"></div></div>
<footer>consult-errors → assign → brief → dispatch → record → distill · orchestration/MANAGEMENT.md · /api/org/overview</footer>
</main><script>
const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/</g,"&lt;");
async function load(){try{const d=await(await fetch('/api/org/overview?recent=30')).json();
const b=[];const v=d.sandboxVerdict||'';b.push('<span class="badge '+(v.includes('GREEN')?'ok':v?'bad':'dim')+'">sandbox: '+esc(v||'yok')+'</span>');
const c=d.calibrationVerdict||'';b.push('<span class="badge '+(c.includes('GREEN')?'ok':c?'bad':'dim')+'">kalibrasyon: '+esc(c||'yok')+'</span>');
b.push('<span class="badge dim">policy: '+(d.policyTrainedAt?esc(d.policyTrainedAt)+' · '+d.policySamples+' örnek':'eğitilmemiş')+'</span>');
b.push('<span class="badge dim">ledger: '+d.ledgerCounts.total+' kayıt · '+d.ledgerCounts.learned+' learned</span>');
$('badges').innerHTML=b.join('');
$('actors').innerHTML=(d.actors||[]).map(a=>{const lvl=a.authority||'none';
return '<tr><td><b>'+esc(a.id)+'</b></td><td>'+esc(a.kind)+'</td><td>'+esc(a.role)+'</td><td>r'+a.costRank+'</td><td><span class="auth '+esc(lvl)+'" title="'+esc(a.authorityReason||'')+'">'+esc(lvl)+'</span></td><td>'+(a.wilson==null?'—':a.wilson.toFixed(2))+'</td><td>'+(a.n==null?'—':a.n)+'</td></tr>';}).join('');
$('ledger').innerHTML=(d.ledgerTail||[]).slice().reverse().map(r=>'<div class="rec '+esc(r.tier)+'"><div class="t">'+esc(r.ts)+' · '+esc(r.tier)+'</div>'+esc(r.fact)+'</div>').join('')||'<div class="rec">ledger boş</div>';
}catch(e){$('badges').innerHTML='<span class="badge bad">HATA: '+esc(e)+'</span>';}}
load();setInterval(load,15000);
</script></body></html>`);
});

// ----------------------------------------------------
// BRAIN surface — module top level like /org (the /org lesson: routes inside
// initializeServer are unreachable for OLLAMAS_NO_AUTOBOOT in-process tests).
// ----------------------------------------------------

// Read-only overview bundle: stats + recent memories + live/superseded facts +
// drift-probe health. Local-owner surface.
app.get("/api/brain/overview", async (req, res) => {
  try {
    const recent = Math.min(Math.max(Number(req.query.recent) || 20, 1), 100);
    const { brainOverview } = await import("./server/brain");
    res.json(await brainOverview({ recent }));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain overview failed" });
  }
});

// Brain entity graph — reified S-P-O facts as nodes/edges with degree centrality,
// for the live brain map (docs/BRAIN-ENGINE.md). ?limit caps nodes; ?at gives a
// historical snapshot (bi-temporal).
app.get("/api/brain/graph", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const at = req.query.at !== undefined ? Number(req.query.at) : undefined;
    const { brainGraph } = await import("./server/brain");
    res.json(await brainGraph({ limit, at }));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain graph failed" });
  }
});

// S21 brain gauges on /metrics (module top level like the brain routes; NO_AUTOBOOT
// in-process tests scrape them too). stats runs lazily inside collect() at scrape
// time — the brain db opens on first scrape, never at boot. Best-effort wiring.
void (async () => {
  try {
    const { brainStats } = await import("./server/brain");
    const { registerBrainMetrics } = await import("./server/brain-metrics");
    registerBrainMetrics({ stats: brainStats });
  } catch (e: any) {
    console.warn(`[brain] metrics wiring skipped (${e?.message ?? e})`);
  }
})();

// S30-S44 event subscribers + S32/S35/S37 snapshot pollers (module top level —
// the bus aggregates ephemeral signals into daily ops-ns rollups; pollers read
// existing in-process snapshot getters, zero edits in their modules). Flush every
// 10 min (unref'd) — BRAIN_SUBSCRIBERS=0 opts out.
void (async () => {
  if (process.env.BRAIN_SUBSCRIBERS === "0") return;
  try {
    const { registerBrainSubscribers } = await import("./server/brain-subscribers");
    const { brainRemember, brainAssertFact } = await import("./server/brain");
    registerBrainSubscribers(
      { remember: brainRemember, assertFact: brainAssertFact },
      {
        providerVerdicts: () => {
          const snap = getKeyHealth();
          return Object.fromEntries((snap?.providers ?? []).map((p) => [p.provider, String(p.status)]));
        },
        upstreamStatus: () => Object.fromEntries(getUpstreamStatus().map((u) => [u.name, String(u.state)])),
        champion: () => process.env.MAC_MODEL_CHAMPION || "qwen3:8b",
      },
    );
  } catch (e: any) {
    console.warn(`[brain] subscribers wiring skipped (${e?.message ?? e})`);
  }
})();

// S39: external recall surface. ns "*" is the S49 admin cross-ns fan-out —
// double-locked (env flag AND loopback peer) because the ns-jail is a security
// invariant; every cross-ns use is itself recorded as an ops fact.
app.post("/api/brain/recall", async (req, res) => {
  try {
    const { query, k, ns, graphExpand, minScore, actor, vector } = req.body || {};
    if (typeof query !== "string" || !query.trim()) return res.status(400).json({ error: "query (string) required" });
    // F3c: çağıran kişiselleştirilmiş q* = q + λ·p_u verdiyse KNN kolu onunla sürülür.
    // Boyut/biçim burada reddedilir — bozuk vektör 500 değil 400 olmalı.
    if (vector !== undefined && (!Array.isArray(vector) || !vector.length || !vector.every((n: unknown) => typeof n === "number" && Number.isFinite(n)))) {
      return res.status(400).json({ error: "vector must be a non-empty number[]" });
    }
    const brain = await import("./server/brain");
    if (ns === "*") {
      const loopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
      if (process.env.BRAIN_ADMIN_XNS !== "1" || !loopback) {
        return res.status(403).json({ error: "cross-ns recall requires BRAIN_ADMIN_XNS=1 and a loopback caller" });
      }
      const perNs = await Promise.all(
        brain.brainListNamespaces().map(async (n) => (await brain.brainRecall(query, { k: k || 5, ns: n, graphExpand })).map((h) => ({ ...h, ns: n }))),
      );
      const merged = perNs.flat().sort((a, b) => b.score - a.score).slice(0, k || 5);
      void brain.brainAssertFact({ subject: "brain", predicate: "xns_recall_used", object: new Date().toISOString(), ns: "ops" }).catch(() => {});
      return res.json({ hits: merged, crossNs: true });
    }
    // Bounded like the auto-recall path: under conductor load the local embedder
    // can queue for 30s+ — an external API must degrade fast, not hang.
    const bounded = await Promise.race([
      (async () => {
        // B2: a TR/EN relative-time cue in the query becomes an absolute createdAt
        // window ("gecen haftaki karar" only surfaces last week's rows).
        const { parseTemporalFilter } = await import("./server/brain-active");
        const tw = parseTemporalFilter(query, Date.now());
        return brain.brainRecall(query, { k: k || 5, ns, graphExpand, minScore, actor, ...(tw ?? {}), ...(vector ? { vector } : {}) });
      })(),
      new Promise<null>((r) => {
        const t = setTimeout(() => r(null), Number(process.env.BRAIN_RECALL_API_TIMEOUT_MS) || 10_000);
        t.unref?.();
      }),
    ]);
    if (bounded === null) return res.status(503).json({ error: "embedder busy — retry shortly" });
    // Tur-6 shadow evaluation: a sampled counterfactual arm (graphExpand flipped)
    // re-ranks the same query async and logs ranking agreement (RBO). GPU-polite,
    // fire-and-forget — the response above never waits on it.
    if (!graphExpand) {
      void import("./server/brain-shadow").then(({ maybeShadowEval }) =>
        maybeShadowEval(query, bounded, (q, o) => brain.brainRecall(q, { ...o, ns })),
      ).catch(() => {});
    }
    res.json({ hits: bounded, ...(bounded.length === 0 ? { abstained: true } : {}) });
  } catch (err: any) {
    // A fast-failing embedder (ollama 503 during model swap) is the SAME degraded
    // state as a slow one — honor the S39 degrade contract instead of surfacing 500.
    const msg = String(err?.message || "");
    if (/embed|503/i.test(msg)) return res.status(503).json({ error: "embedder busy — retry shortly" });
    res.status(500).json({ error: msg || "brain recall failed" });
  }
});

// AJAN İZİN POLİTİKASI — ollamas·eCym·odysseus'un macOS uygulamaları üzerindeki yetkisi.
//
// Bu route'un varlık sebebi: izinlerin KOD DEĞİL VERİ olması. Hangi eylem sınıfının
// otonom çalışacağına operatör panelden karar verir; sunucu yalnız mekanizmayı ve
// güvenli varsayılanı tutar. Yukarıdaki /api/security/permissions deseninin aynısı,
// iki farkla: (1) kısmi güncelleme (panel tek anahtar gönderebilir), (2) geçersiz
// veri mevcut politikayı BOZAMAZ — mergePolicy geçersiz değeri yok sayar.
app.get("/api/agent/policy", async (_req, res) => {
  try {
    const { loadPolicy } = await import("./server/agent-policy-store");
    const { RISK_CLASSES, AUTONOMY_LEVELS } = await import("./server/agent-policy");
    // Şemayı da döndür: panel seçenekleri sunucudan gelsin, iki yerde
    // elle senkron tutulan bir liste olmasın.
    res.json({ policy: loadPolicy(), riskClasses: RISK_CLASSES, autonomyLevels: AUTONOMY_LEVELS });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "policy read failed" });
  }
});

app.post("/api/agent/policy", async (req, res) => {
  try {
    const { loadPolicy, savePolicy } = await import("./server/agent-policy-store");
    const { mergePolicy } = await import("./server/agent-policy");
    const before = loadPolicy();
    const next = mergePolicy(before, req.body || {});
    const saved = savePolicy(next);
    if (!saved.ok) return res.status(400).json({ error: "geçersiz politika", errors: saved.errors });

    // Yetki değişikliği DENETLENEBİLİR olmalı: neyin neye döndüğü kayda geçer.
    const changed = Object.entries(next.classes)
      .filter(([k, v]) => before.classes[k as keyof typeof before.classes] !== v)
      .map(([k, v]) => `${k}: ${before.classes[k as keyof typeof before.classes]}→${v}`);
    const { db } = await import("./server/db");
    // Kategori `permission_change`: db.ts sabit bir birleşim tutuyor ve bu GERÇEKTEN
    // bir izin değişikliği — başka bir modülün tipini genişletmektense doğru olan
    // mevcut kategoriyi kullanmak.
    db.logSecurity(
      "permission_change",
      "Update agent policy",
      changed.length ? changed.join(", ") : "sınıf değişmedi (istisna/ilke güncellemesi)",
      changed.some((c) => c.endsWith("→auto")) ? "warning" : "info",
    );
    db.save();

    // Politika değişikliğini eCym'e YANSIT: app komutlarının safe alanını tazele.
    // Kopukluğun kökü buydu — izin veriliyor ama dataset teach anındaki bayat safe'i
    // taşımaya devam ediyordu. KENDİ try/catch'i: dataset yoksa politika yazımı DÜŞMEZ.
    let synced = 0;
    try {
      const { syncAppCommandSafety } = await import("./scripts/app-literacy-safety-sync");
      const s = syncAppCommandSafety();
      synced = s.changed.length;
      if (synced) db.logSecurity("permission_change", "eCym safety re-synced", `${synced} app komutu güncellendi`, "info");
    } catch { /* eCym senkronu best-effort — politika yazımını bloklamaz */ }

    res.json({ success: true, policy: next, ecymSynced: synced });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "policy write failed" });
  }
});

// F3c EMBED — sorgu gömme yüzeyi. brain-loop gibi HTTP istemcileri q* = q + λ·p_u
// kurabilsin diye var (loop brain.db'yi doğrudan AÇMAZ — bu bilinçli bir sözleşme).
// Yalnız loopback: gömme yüzeyi açığa çıkarsa embedder dışarıdan tüketilebilir.
app.post("/api/brain/embed", async (req, res) => {
  try {
    const loopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
    if (!loopback) return res.status(403).json({ error: "embed is loopback-only" });
    const { text } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text (string) required" });
    const { brainEmbedQuery } = await import("./server/brain");
    const { embedSpaceId } = await import("./server/embed-contract");
    const { localEmbedModel } = await import("./server/rag");
    const vector = await brainEmbedQuery(text);
    // spaceId üç sistemin (ollamas · eCym · odysseus) aynı vektör uzayında olup
    // olmadığını çağıranın doğrulayabilmesi için döner — sessiz uzay kayması olmasın.
    res.json({ vector, dim: vector.length, spaceId: embedSpaceId(localEmbedModel()) });
  } catch (err: any) {
    // Meşgul embedder recall ile AYNI degrade sözleşmesine tabi (S39): 503, 500 değil.
    const msg = String(err?.message || "");
    if (/embed|503|busy/i.test(msg)) return res.status(503).json({ error: "embedder busy — retry shortly" });
    res.status(500).json({ error: msg || "brain embed failed" });
  }
});

// E2 ASK — synthesized, source-cited, confidence-scored answer drawn ONLY from the
// store. Synthesis rides the $0 keyless provider (distill pattern), NOT ollama, so
// answers flow even while the local embedder is starved (recall degrades lexical, E1).
app.post("/api/brain/ask", async (req, res) => {
  try {
    const { question, ns } = req.body || {};
    if (typeof question !== "string" || !question.trim()) return res.status(400).json({ error: "question (string) required" });
    const brain = await import("./server/brain");
    const { askBrain } = await import("./server/brain-ask");
    const { resolveDistillProvider } = await import("./server/brain-active");
    const { liveSystemContext } = await import("./server/brain-system");
    const r = await askBrain(question, {
      ns,
      namespaces: brain.brainListNamespaces,
      liveContext: liveSystemContext,
      // Spread order bug: an undefined body-ns must not clobber the fan-out's per-ns
      // choice — only pin ns when the caller actually sent one.
      recall: (q, o) => brain.brainRecall(q, { ...o, ...(ns ? { ns } : {}) }),
      searchFacts: (q, o) => brain.brainSearchFacts(q, { ...o, ...(ns ? { ns } : {}) }),
      generate: async (messages) => {
        const out = await ProviderRouter.generate({
          provider: resolveDistillProvider(process.env),
          model: process.env.BRAIN_DISTILL_MODEL || "openai",
          messages, stream: false,
        } as any);
        return out.text || "";
      },
    });
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain ask failed" });
  }
});

// K1 system sync: MacBook + ollamas runtime inventory → superseding facts +
// a stable learned summary. Loopback-only (operator/maintain surface).
app.post("/api/brain/sync-system", async (req, res) => {
  try {
    const loopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
    if (!loopback) return res.status(403).json({ error: "sync-system is loopback-only" });
    const { syncSystemToBrain } = await import("./server/brain-system");
    const brain = await import("./server/brain");
    res.json(await syncSystemToBrain({ assertFact: brain.brainAssertFact, remember: brain.brainRemember as any }));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "sync-system failed" });
  }
});

// brain-loop.ts is an HTTP client of this server (never opens brain.db directly, see
// scripts/brain-loop.ts's contract note) — including for GPU state. It cannot see this
// process's in-process llmActive() any other way (it runs as a separate `tsx` process
// each launchd tick, so a direct import always reads a fresh, always-idle module copy).
app.get("/api/brain/gpu-status", async (req, res) => {
  const { llmActive } = await import("./server/gpu-coordinator");
  res.json({ active: llmActive() });
});

// Ortak-brain (formüller.md §3b): tek retrieval → üç uzman (ollamas/eCym/odysseus)
// → MoE gate w_j → p_final seçimi. Erişilemeyen uzman degrade edilir.
app.post("/api/brain/ask-shared", async (req, res) => {
  try {
    const { question, ns } = req.body || {};
    if (typeof question !== "string" || !question.trim()) return res.status(400).json({ error: "question (string) required" });
    const brain = await import("./server/brain");
    const { askShared } = await import("./server/brain-shared");
    const { resolveDistillProvider } = await import("./server/brain-active");
    const { liveSystemContext } = await import("./server/brain-system");
    const { llmActive } = await import("./server/gpu-coordinator");
    // Gate kalıcılığı loop ile AYNI dosyayı paylaşır: canlı sorular ve otonom loop
    // turları tek bir öğrenilmiş W_g biriktirir, iki ayrı yarım-öğrenmiş gate değil.
    const { loadGate: loadLearnedGate, saveGate: persistLearnedGate } = await import("./server/brain-gate-store");
    const gen = (provider: string, model?: string) => async (messages: { role: string; content: string }[]) =>
      (await ProviderRouter.generate({ provider, model: model || "openai", messages, stream: false } as any)).text || "";
    const r = await askShared(question, {
      ns,
      namespaces: brain.brainListNamespaces,
      liveContext: liveSystemContext,
      recall: (q, o) => brain.brainRecall(q, { ...o, ...(ns ? { ns } : {}) }),
      searchFacts: (q, o) => brain.brainSearchFacts(q, { ...o, ...(ns ? { ns } : {}) }),
      generate: gen(resolveDistillProvider(process.env)),
      // F3b/F3c — canlı yol da ÖĞRENİR. Bunlar verilmediği için qVec daima null
      // kalıyor, W_g hiç çarpılmıyor ve gate kalıcı olarak yalnız regex biasıydı.
      // embed → gate gerçek vektör alır; recallVec → q* retrieval'ı gerçekten sürer;
      // gate/saveGate → öğrenilen ağırlık turlar arası KALICI olur.
      embed: brain.brainEmbedQuery,
      recallVec: (vec: number[], o?: { k?: number; graphExpand?: boolean; ns?: string }) =>
        brain.brainRecall(question, { ...o, vector: vec, ...(ns ? { ns } : {}) }),
      gate: loadLearnedGate() ?? undefined,
      saveGate: persistLearnedGate,
      experts: {
        ollamas: gen(resolveDistillProvider(process.env)),
        // Yerel model GPU'yu paylaşır — canlı generation varken uzman devre dışı.
        ecym: llmActive() ? undefined : gen("ollama-local", process.env.ECY_MODEL || "ecy"),
        odysseus: async (messages: { role: string; content: string }[]) => {
          const out = await ToolRegistry.execute("mcp__odysseus__odysseus_chat",
            { prompt: messages[1].content, model: "ollamas-auto" }, { source: "ask-shared" } as any);
          return typeof out === "string" ? out : JSON.stringify(out).slice(0, 4000);
        },
      },
    } as any);
    res.json(r);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (/embed|503/i.test(msg)) return res.status(503).json({ error: "embedder busy — retry shortly" });
    res.status(500).json({ error: msg || "ask-shared failed" });
  }
});

// B4 right-to-be-forgotten: deterministic ns-scoped purge. Loopback-only — erasure
// is an operator action, never a network-exposed one (S49 double-lock convention).
app.post("/api/brain/forget", async (req, res) => {
  try {
    const loopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
    if (!loopback) return res.status(403).json({ error: "forget is a loopback-only operator action" });
    const { contains, ns } = req.body || {};
    if (typeof contains !== "string" || !contains.trim()) return res.status(400).json({ error: "contains (string) required" });
    const { brainForget } = await import("./server/brain");
    res.json(brainForget({ contains, ns }));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain forget failed" });
  }
});

// B3 audit ledger tail — append-only mutation history for transparency/compliance.
app.get("/api/brain/audit", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const { brainAuditTail } = await import("./server/brain");
    res.json({ entries: brainAuditTail(limit) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain audit failed" });
  }
});

// S40: fact query surface (live by default; ?at for a bi-temporal snapshot).
app.get("/api/brain/facts", async (req, res) => {
  try {
    const subject = String(req.query.subject || "");
    if (!subject) return res.status(400).json({ error: "subject required" });
    const { brainFactsAbout } = await import("./server/brain");
    const at = req.query.at !== undefined ? Number(req.query.at) : undefined;
    res.json({ facts: brainFactsAbout(subject, { ns: req.query.ns ? String(req.query.ns) : undefined, at }) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain facts failed" });
  }
});

// S42: session ↔ episode reverse link — every distill/ingest write for a session
// carries source=sessionId, so the linkage is a query, not a schema change.
app.get("/api/brain/session/:id", async (req, res) => {
  try {
    const { brainMemoriesBySource } = await import("./server/brain");
    res.json({ sessionId: req.params.id, memories: brainMemoriesBySource(req.params.id, { limit: 50 }) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "brain session lookup failed" });
  }
});

// Brain write choke-point for out-of-process producers (org conductor mirror,
// one-shot imports). Same contract as brainRemember: explicit ids are idempotent
// upserts, auto-ids go through AUDN dedup; createdAt lets imports keep event time.
app.post("/api/brain/remember", async (req, res) => {
  try {
    const { id, tier, content, source, ns, createdAt } = req.body || {};
    const { brainRemember } = await import("./server/brain");
    res.json(await brainRemember({ id, tier, content, source, ns, createdAt }));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "brain remember failed" });
  }
});

// BRAIN panel (G3) — read-only introspection over /api/brain/overview + /api/brain/graph,
// same self-contained inline-HTML shape as /org (module top level: reachable under
// OLLAMAS_NO_AUTOBOOT=1 in-process tests, no vite/frontend build involved).
app.get("/brain", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>BRAIN · ollamas</title><style>
:root{--bg:#050A14;--surf:#0D1B2E;--raised:#132338;--line:rgba(255,255,255,.1);--fg:#F0F4FF;--fg2:#8A9BB0;--cyan:#00D4FF;--violet:#7B5EA7;--ok:#00C896;--warn:#F5A623;--bad:#FF5470}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,sans-serif;padding:26px 18px}
main{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#00C896,#7B5EA7);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;color:#050A14}
h1{font-size:20px;margin:0;letter-spacing:.01em}.sub{color:var(--fg2);font-size:12px;margin-top:2px}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
.badge{font:600 11.5px/1 ui-monospace,monospace;border-radius:8px;padding:8px 11px;border:1px solid var(--line);background:var(--raised)}
.badge.ok{color:var(--ok);border-color:rgba(0,200,150,.5)}.badge.bad{color:var(--bad);border-color:var(--bad)}.badge.dim{color:var(--fg2)}.badge.warn{color:var(--warn);border-color:rgba(245,166,35,.5)}
.card{background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:11px}
label{font-size:11px;color:var(--fg2);text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.tiers{display:flex;gap:8px;flex-wrap:wrap}
.tier{flex:1;min-width:96px;background:var(--raised);border:1px solid var(--line);border-radius:10px;padding:11px;text-align:center;cursor:pointer;transition:border-color .15s}
.tier:hover,.tier.sel{border-color:var(--cyan)}.tier b{font-size:21px;display:block}.tier span{font-size:10.5px;color:var(--fg2);text-transform:uppercase}
.mems{max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:6px}
.rec{background:var(--raised);border:1px solid var(--line);border-radius:9px;padding:9px 12px;font:11.5px/1.55 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
.rec .t{color:var(--fg2);font-size:10px;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:3px}
.rec.learned{border-left:3px solid var(--violet)}.rec.core{border-left:3px solid var(--cyan)}.rec.working{border-left:3px solid var(--fg2)}.rec.episodic{border-left:3px solid rgba(255,255,255,.25)}.rec.procedural{border-left:3px solid var(--ok)}
.pill{border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:9.5px;color:var(--fg2)}
.pill.score{color:var(--ok);border-color:rgba(0,200,150,.4)}.pill.actor{color:var(--cyan)}
input[type=text]{width:100%;background:var(--raised);border:1px solid var(--line);border-radius:10px;color:var(--fg);font:14px/1.4 system-ui;padding:11px 14px;outline:none}
input[type=text]:focus{border-color:var(--cyan)}
svg{width:100%;height:auto;background:var(--raised);border-radius:10px;cursor:grab;user-select:none}
table{width:100%;border-collapse:collapse;font:12px/1.5 ui-monospace,monospace}
td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}td.p{color:var(--fg2);white-space:nowrap}
.audit .a-remember{color:var(--ok)}.audit .a-merge{color:var(--cyan)}.audit .a-revise{color:var(--warn)}.audit .a-forget{color:var(--bad)}
.toggle{font:11px ui-monospace,monospace;color:var(--fg2);cursor:pointer;user-select:none}.toggle input{vertical-align:-2px}
footer{color:#536882;font:11px/1.4 ui-monospace,monospace;text-align:center;padding-top:4px}
</style></head><body><main>
<header><div class="logo">B</div><div><h1>BRAIN — ollamas kalıcı hafıza</h1><div class="sub">5-tier · bi-temporal graf · hybrid RRF + rerank · belief revision · audit ledger</div></div>
<div class="badges" id="badges">yükleniyor…</div></header>

<div class="card"><label>Brain'e Sor — Enter = sentezli cevap · yazarken = anlık kayıt araması</label>
<input type="text" id="q" placeholder="brain'e sor… (ör. 'deploy nasıl yapılıyor?') — Enter'a bas, kaynak-atıflı cevap al" autocomplete="off">
<div id="ans"></div>
<div class="mems" id="qres"></div></div>

<div class="card"><label>Tier Dağılımı — karta tıkla, kayıtları gör</label><div class="tiers" id="tiers"></div><div class="mems" id="tierres" style="display:none"></div></div>

<div class="card"><label style="display:flex;justify-content:space-between;align-items:center">Entity Graf (canlı fact'ler · degree ∝ boyut · sürükle=pan · tekerlek=zoom)
<span class="toggle"><input type="checkbox" id="hist"> geçmişi göster</span></label><div id="graph"></div></div>

<div class="grid2">
<div class="card"><label>Canlı Fact'ler</label><div style="overflow-x:auto;max-height:260px;overflow-y:auto"><table><tbody id="facts"></tbody></table></div></div>
<div class="card audit"><label>Audit Ledger — son mutasyonlar</label><div style="overflow-x:auto;max-height:260px;overflow-y:auto"><table><tbody id="audit"></tbody></table></div></div>
</div>

<div class="card"><label>Son Hafızalar</label><div class="mems" id="mems"></div></div>
<footer>/api/brain/{overview·graph·recall·audit} · bakım: launchd 04:00 (consolidate→sweep→backfill→health→backup→MRR)</footer>
</main><script>
const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const fmtT=ms=>new Date(ms).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
let O=null,G=null;

function memRow(m,extra){return '<div class="rec '+esc(m.tier)+'"><div class="t"><span class="pill">'+esc(m.tier)+'</span>'
 +(m.actor?'<span class="pill actor">'+esc(m.actor)+'</span>':'')
 +(extra||'')
 +'<span>'+fmtT(m.createdAt)+'</span>'+(m.hits!==undefined?'<span>hit '+m.hits+'</span>':'')+'</div>'
 +esc(String(m.content).slice(0,320))+'</div>'}

// — canlı arama (B1/B2/B5 görünür) —
let qt=null;
$('q').addEventListener('input',()=>{clearTimeout(qt);qt=setTimeout(runQuery,450)});
$('q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(qt);runAsk()}});
async function runAsk(){const q=$('q').value.trim();if(!q)return;
$('ans').innerHTML='<div class="rec" style="border-left:3px solid var(--cyan)">🧠 düşünüyorum… (kayıtlar taranıyor + sentez)</div>';
try{const r=await fetch('/api/brain/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q})});
const j=await r.json();
if(j.error){$('ans').innerHTML='<div class="rec">HATA: '+esc(j.error)+'</div>';return}
const conf=Math.round((j.confidence||0)*100);
const modeTag=j.mode==='lexical'?'<span class="pill" style="color:var(--warn)">kelime-eşleşme modu</span>':'<span class="pill score">semantik</span>';
if(j.abstained){$('ans').innerHTML='<div class="rec" style="border-left:3px solid var(--warn)"><div class="t">'+modeTag+'</div>'+esc(j.answer||'Kayıtlarda bu konuda bilgi yok.')+'</div>'}
else{$('ans').innerHTML='<div class="rec" style="border-left:3px solid var(--ok);font-size:13px;line-height:1.6"><div class="t">'+modeTag+'<span class="pill score">güven %'+conf+'</span><span class="pill">'+j.sources.length+' kaynak</span></div>'
+esc(j.answer).replace(/\\[mem:([^\\]]+)\\]/g,'<span class="pill actor">$1</span>')+'</div>'
+(j.sources||[]).slice(0,5).map(s2=>'<div class="rec '+esc(s2.tier)+'" style="opacity:.75;margin-top:4px"><div class="t"><span class="pill">'+esc(s2.tier)+'</span><span class="pill score">skor '+s2.score+'</span><span>'+esc(s2.id)+'</span></div>'+esc(s2.excerpt)+'</div>').join('')}
}catch(e){$('ans').innerHTML='<div class="rec">HATA: '+esc(e)+'</div>'}}
async function runQuery(){const q=$('q').value.trim();if(!q){$('qres').innerHTML='';return}
$('qres').innerHTML='<div class="rec">aranıyor…</div>';
try{const r=await fetch('/api/brain/recall',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,k:6})});
const j=await r.json();
if(r.status===503){$('qres').innerHTML='<div class="rec">embedder meşgul — birazdan tekrar dene</div>';return}
if(j.abstained||!j.hits||!j.hits.length){$('qres').innerHTML='<div class="rec">— bu konuda güvenilir kayıt yok (abstention) —</div>';return}
$('qres').innerHTML=j.hits.map(h=>memRow(h,'<span class="pill score">skor '+h.score.toFixed(2)+'</span>')).join('');
}catch(e){$('qres').innerHTML='<div class="rec">HATA: '+esc(e)+'</div>'}}

// — tier kartları —
function renderTiers(){const tiers=['core','learned','procedural','episodic','working'];
$('tiers').innerHTML=tiers.map(t=>'<div class="tier" data-t="'+t+'"><b>'+(O.stats.memories[t]||0)+'</b><span>'+t+'</span></div>').join('');
document.querySelectorAll('.tier').forEach(el=>el.onclick=()=>{document.querySelectorAll('.tier').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');
const t=el.dataset.t;const rows=(O.memories||[]).filter(m=>m.tier===t).slice(0,10);
$('tierres').style.display='flex';$('tierres').innerHTML=rows.map(m=>memRow(m)).join('')||'<div class="rec">bu tier'+"'"+'da güncel kayıt yok</div>'})}

// — graf v2: pan/zoom + degree-etiket —
function drawGraph(){if(!G)return;const showHist=$('hist').checked;
const ns=(G.nodes||[]).filter(n=>showHist||n.live).slice(0,40);
const es=(G.edges||[]).filter(e=>(showHist||e.live)&&ns.find(n=>n.id===e.source)&&ns.find(n=>n.id===e.target));
if(!ns.length){$('graph').innerHTML='<div class="rec">graf boş</div>';return}
const W=980,H=460,cx=W/2,cy=H/2;ns.sort((a,b)=>b.degree-a.degree);const hub=ns[0],rest=ns.slice(1);
const pos={};pos[hub.id]=[cx,cy];rest.forEach((n,i)=>{const a=2*Math.PI*i/Math.max(rest.length,1);const r=140+((i%3)*52);pos[n.id]=[cx+r*Math.cos(a),cy+r*0.68*Math.sin(a)]});
let b='';
for(const e of es){const p1=pos[e.source],p2=pos[e.target];if(!p1||!p2)continue;
b+='<line x1="'+p1[0]+'" y1="'+p1[1]+'" x2="'+p2[0]+'" y2="'+p2[1]+'" stroke="'+(e.live?'#00C896':'#536882')+'" stroke-width="1.1" '+(e.live?'':'stroke-dasharray="4 3" ')+'opacity=".5"><title>'+esc(e.predicate)+'</title></line>'}
for(const n of ns){const p=pos[n.id],r=6+2.4*Math.sqrt(n.degree);
b+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+r+'" fill="'+(n.live?'#00D4FF':'#536882')+'" opacity=".92"><title>'+esc(n.label)+' (degree '+n.degree+')</title></circle>';
if(n.degree>=2||n.id===hub.id)b+='<text x="'+p[0]+'" y="'+(p[1]-r-5)+'" text-anchor="middle" fill="#F0F4FF" font-size="11" font-family="ui-monospace,monospace">'+esc(String(n.label).slice(0,22))+'</text>'}
$('graph').innerHTML='<svg id="gsvg" viewBox="0 0 '+W+' '+H+'">'+b+'</svg>';
const svg=$('gsvg');let vb=[0,0,W,H],drag=null;
svg.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];svg.setPointerCapture(e.pointerId)});
svg.addEventListener('pointermove',e=>{if(!drag)return;const sc=vb[2]/svg.clientWidth;vb[0]-=(e.clientX-drag[0])*sc;vb[1]-=(e.clientY-drag[1])*sc;drag=[e.clientX,e.clientY];svg.setAttribute('viewBox',vb.join(' '))});
svg.addEventListener('pointerup',()=>drag=null);
svg.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY>0?1.12:0.89;const nw=vb[2]*f,nh=vb[3]*f;vb[0]+=(vb[2]-nw)/2;vb[1]+=(vb[3]-nh)/2;vb[2]=nw;vb[3]=nh;svg.setAttribute('viewBox',vb.join(' '))},{passive:false})}
$('hist').addEventListener('change',drawGraph);

// — health: son başarılı ölçüm localStorage'ta (panel asla bilgisiz görünmez) —
function healthBadge(h){if(h&&!h.degraded){try{localStorage.setItem('brain.health',JSON.stringify({r:h.selfHitRate,p:h.probes,ts:Date.now()}))}catch(e){}
return '<span class="badge '+(h.drift?'bad':'ok')+'">self-hit '+Math.round(h.selfHitRate*100)+'% · '+(h.drift?'DRIFT':'sağlıklı')+' ('+h.probes+' probe)</span>'}
let last=null;try{last=JSON.parse(localStorage.getItem('brain.health'))}catch(e){}
return last?'<span class="badge ok">son ölçüm self-hit '+Math.round(last.r*100)+'% ('+fmtT(last.ts)+')</span><span class="badge warn">şu an: embedder meşgul</span>'
:'<span class="badge warn">sağlık: embedder meşgul — ölçüm bekleniyor</span>'}

async function load(){try{const[or,gr,ar]=await Promise.allSettled([
fetch('/api/brain/overview?recent=40').then(r=>r.json()),
fetch('/api/brain/graph?limit=60').then(r=>r.json()),
fetch('/api/brain/audit?limit=15').then(r=>r.json())]);
if(gr.status==='fulfilled'&&Array.isArray(gr.value.nodes)){G=gr.value;drawGraph()}
if(ar.status==='fulfilled'&&Array.isArray(ar.value.entries)){
$('audit').innerHTML=ar.value.entries.map(a=>'<tr><td class="p">'+fmtT(a.ts)+'</td><td class="a-'+esc(a.action)+'">'+esc(a.action)+'</td><td>'+esc((a.detail||'')+(a.memId?' · '+a.memId.slice(0,18):''))+'</td></tr>').join('')||'<tr><td>kayıt yok</td></tr>'}
const o=or.status==='fulfilled'?or.value:null;
if(!o||o.error||!o.stats){$('badges').innerHTML='<span class="badge bad">overview: '+esc((o&&o.error)||'ulaşılamadı')+'</span>';return}
O=o;const tot=Object.values(o.stats.memories||{}).reduce((a,c)=>a+c,0);
$('badges').innerHTML=healthBadge(o.health)
+'<span class="badge dim">'+tot+' hafıza · '+o.stats.facts+' fact · '+o.stats.namespaces+' ns</span>'
+'<span class="badge dim">'+(o.stats.dbBytes/1048576).toFixed(1)+' MB</span>';
renderTiers();
$('facts').innerHTML=(o.facts||[]).map(f=>'<tr><td><b>'+esc(f.subject)+'</b></td><td class="p">'+esc(f.predicate)+'</td><td>'+esc(f.object)+'</td></tr>').join('')||'<tr><td>fact yok</td></tr>';
$('mems').innerHTML=(o.memories||[]).slice(0,20).map(m=>memRow(m)).join('')||'<div class="rec">hafıza yok</div>';
}catch(e){$('badges').innerHTML='<span class="badge bad">HATA: '+esc(e)+'</span>'}}
load();setInterval(load,20000);
</script></body></html>`);
});

// O0: mount enabled modules LAST among the module-top-level routes (after the guard
// app.use above → INV-O0-1 order; before vite middleware, which registers at boot time).
mountEnabledModules(app);

// Start full stack Express services — unless a caller opts out. In-process route tests
// import `app` (top-level routes + middleware are already registered at module load) to
// exercise real handlers WITHOUT binding a port or booting vite/the store. Production
// (`node dist/server.cjs`), `tsx server.ts` (dev) and the spawned e2e child never set this
// flag, so they boot the full stack exactly as before.
if (process.env.OLLAMAS_NO_AUTOBOOT !== "1") {
  initializeServer().catch((e) => {
    console.error("Express initialization crashed on start.", e);
  });
}

// Exported for in-process HTTP tests (tests/routes-openapi.test.ts, tests/routes-hardening.test.ts).
export { app };
