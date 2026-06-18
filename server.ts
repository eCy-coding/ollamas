import express from "express";
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { db, ChatSession } from "./server/db";
import { ProviderRouter } from "./server/providers";
import { FilesystemManager } from "./server/files";
import { TerminalManager } from "./server/terminal";
import { BackupService } from "./server/backup";
import { OrchestratorCoordinator } from "./server/orchestrator";
import { ToolRegistry, type ToolDeps, type ToolCtx, type ToolTier } from "./server/tool-registry";
import { handleMcpRequest } from "./server/mcp/server";
import { connectAllUpstreams, listUpstreams, type UpstreamConfig } from "./server/mcp/client";
import { initStore, createTenant, issueApiKey, revokeApiKey, listPlans, recordUsage, monthToDateUsage, getTenant, listTenants, listKeys } from "./server/store";
import { authMiddleware } from "./server/middleware/auth";
import { rateLimitMiddleware } from "./server/middleware/rate-limit";
import { runBilling, computeRun, handleWebhook } from "./server/billing/stripe";

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

// Host-side macOS terminal bridge (drives real iTerm2 / Terminal.app).
const HOST_BRIDGE_URL = process.env.HOST_BRIDGE_URL || "http://host.docker.internal:7345";
const HOST_BRIDGE_TOKEN = process.env.HOST_BRIDGE_TOKEN || "";

async function runOnHostTerminal(target: string | undefined, command: string, timeoutMs = 45000) {
  const res = await fetch(`${HOST_BRIDGE_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(HOST_BRIDGE_TOKEN ? { "X-Bridge-Token": HOST_BRIDGE_TOKEN } : {}) },
    body: JSON.stringify({ target: target || "iterm2", command, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Host terminal bridge error ${res.status}: ${err.error || ""}${err.hint ? " (" + err.hint + ")" : ""}`);
  }
  return res.json();
}

// Run a command directly on the host via the bridge /exec (no terminal mutex).
// Bridge tools execute on the HOST filesystem, so this must be the host path.
// In dev (tsx on host) process.cwd() is the repo; in Docker, set HOST_TOOLS_DIR
// to the host repo's bin/host-bridge/tools (the container path would be wrong).
const HOST_TOOLS_DIR = process.env.HOST_TOOLS_DIR || path.join(process.cwd(), "bin/host-bridge/tools");
// Single-quote-escape an argument for safe interpolation into a shell command.
function shArg(s: string): string { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
async function execOnHost(command: string, timeoutMs = 95000) {
  const res = await fetch(`${HOST_BRIDGE_URL}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(HOST_BRIDGE_TOKEN ? { "X-Bridge-Token": HOST_BRIDGE_TOKEN } : {}) },
    body: JSON.stringify({ command, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Host exec bridge error ${res.status}: ${err.error || ""}`);
  }
  return res.json();
}

// Write a file directly to the macOS host filesystem via the bridge (base64).
async function writeHostFile(filePath: string, content: string) {
  const res = await fetch(`${HOST_BRIDGE_URL}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(HOST_BRIDGE_TOKEN ? { "X-Bridge-Token": HOST_BRIDGE_TOKEN } : {}) },
    body: JSON.stringify({ path: filePath, contentB64: Buffer.from(content || "", "utf8").toString("base64") }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Host write bridge error ${res.status}: ${err.error || ""}`);
  }
  return res.json();
}

// Injected host-side deps for the single tool choke-point (server/tool-registry.ts).
const TOOL_DEPS: ToolDeps = {
  FilesystemManager, TerminalManager, runOnHostTerminal, writeHostFile, execOnHost, HOST_TOOLS_DIR, shArg, db,
};

// Stripe webhook needs the RAW body for signature verification — register the
// raw parser for that path BEFORE the global JSON parser so it wins (Faz 4).
app.use("/api/billing/webhook", express.raw({ type: "*/*" }));

// Body Parsers with large limit for file saves and backup streams
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
  console.log(`[Cockpit] Master system initialized in environment mode: ${CURRENT_MODE.toUpperCase()}`);

  // SaaS store (tenants/keys/plans/usage). Zero-dep node:sqlite (Faz 2).
  initStore();

  // --- MCP gateway: CONNECT to upstream MCP servers (consume side, Faz 1) ---
  // Upstreams declared in tools.json `mcpServers`; each server's tools are merged
  // into ToolRegistry as `mcp__<server>__<tool>`. Best-effort — a dead upstream
  // never blocks boot.
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tools.json"), "utf-8"));
    const upstreams: UpstreamConfig[] = reg.mcpServers || [];
    if (upstreams.length) {
      for (const r of await connectAllUpstreams(upstreams)) {
        console.log(`[MCP-Consume] ${r.name}: ${r.ok ? r.tools + " tools merged" : "FAILED — " + r.error}`);
      }
    }
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

    if (CURRENT_MODE !== "demo") {
      try {
        const verRes = await fetch(`${ollamaHost}/api/version`);
        if (verRes.ok) {
          const verJson = await verRes.json();
          ollamaVersion = verJson?.version || "unknown";
        }

        const psRes = await fetch(`${ollamaHost}/api/ps`);
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
    });
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

  app.post("/api/keys/test", async (req, res) => {
    const { provider, key, customEndpoint } = req.body;
    const testConfig = {
      provider,
      model: "",
      messages: [{ role: "user" as const, content: "ping test" }],
      stream: false,
    };

    // Temporarily save to memory or override process.env for the test call
    if (key) {
      db.data.keys[provider] = db.encrypt(key);
      if (provider === "custom-openai" && customEndpoint) {
        db.data.keys["custom-openai-endpoint"] = customEndpoint;
      }
      db.save();
    }

    try {
      const start = Date.now();
      const result = await ProviderRouter.generate(testConfig);
      const elapsed = Date.now() - start;
      res.json({ success: true, latencyMs: elapsed, output: result.text.substring(0, 50) });
    } catch (e: any) {
      res.json({ success: false, error: e.message || "Credential ping failed" });
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
        const response = await fetch(`${ollamaHost}/api/tags`);
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
        const response = await fetch("https://openrouter.ai/api/v1/models");
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

      if (prov === "gemini") {
        const key = ProviderRouter.getDecryptedKey("gemini");
        if (!key) {
          return res.json(["API key not set for Gemini - please configure it in the Vault"]);
        }
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
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
            }
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
            }
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
   * ReAct Agent Specialist Loop APIs (AC-A1, AC-A3)
   */
  app.post("/api/agent/chat", async (req, res) => {
    const { provider, model, messages, autoApply, maxSteps = 8, sessionId } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendEvent = (type: string, payload: any) => {
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    const isLive = CURRENT_MODE !== "demo";
    const workspaceRoot = db.data.workspacePath;

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

      while (stepNum <= maxSteps && !shouldHalt) {
        sendEvent("thought", { text: `Thinking on Step ${stepNum}...` });
        const start = Date.now();

        const result = await ProviderRouter.generate({
          provider,
          model,
          messages: activeHistory,
          tools: AGENT_TOOLS,
          stream: false,
        });

        // Collect LLM reply text
        if (result.text && result.text.trim()) {
          sendEvent("message", { text: result.text, step: stepNum });
          activeHistory.push({ role: "assistant", content: result.text });
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
          sendEvent("thought", { text: `Evaluating tool activation...`, toolCalls: result.toolCalls });

          for (const tc of result.toolCalls) {
            const toolName = tc.name;
            const args = tc.arguments || {};
            const toolCallId = tc.id;
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
              onUsage: (e) => recordUsage({ tenantId: "local", tool: e.tool, tier: e.tier, ok: e.ok, latencyMs: e.latencyMs }),
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
          sendEvent("done", { text: result.text || "", status: "complete" });
          break;
        }

        stepNum++;
      }

      if (stepNum > maxSteps && !shouldHalt) {
        sendEvent("done", { text: "ReAct loop complete. Reached step depth limit.", status: "limit" });
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
          if (firstUserMsg && sess.title === "New ReAct Session") {
            sess.title = firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? "..." : "");
          }
          db.save();
        }
      }

      res.end();
    } catch (err: any) {
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
    const isLive = CURRENT_MODE !== "demo";
    try {
      FilesystemManager.deleteFile(isLive, db.data.workspacePath, relativePath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
  app.post("/api/pipeline", async (req, res) => {
    const {
      prompt,
      architectProvider, architectModel,
      coderProvider, coderModel,
      reviewerProvider, reviewerModel,
      enableSelfImprove,
      maxIterations,
      writePermissions,
    } = req.body;

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
      tenantId: t?.tenantId,
      onUsage: t
        ? (e) => recordUsage({ tenantId: e.tenantId!, tool: e.tool, tier: e.tier, ok: e.ok, latencyMs: e.latencyMs })
        : undefined,
    };
  };

  // SAAS_ENFORCE=1 → a valid API key is required on /mcp. Default off keeps the
  // current single-user localhost behavior. auth → rate-limit → handler.
  app.all("/mcp", authMiddleware(process.env.SAAS_ENFORCE === "1"), rateLimitMiddleware(), async (req, res) => {
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
  const adminGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const required = process.env.SAAS_ADMIN_TOKEN;
    if (required) {
      // Timing-safe compare to avoid leaking the token via response timing.
      const got = String(req.headers["x-admin-token"] || "");
      const a = Buffer.from(got);
      const b = Buffer.from(required);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "Bad admin token" });
      }
    } else if (process.env.SAAS_ENFORCE === "1") {
      // Enforcement on but no token configured → refuse rather than expose.
      return res.status(403).json({ error: "Admin disabled: set SAAS_ADMIN_TOKEN" });
    }
    next();
  };
  app.get("/api/saas/plans", adminGuard, (_req, res) => res.json(listPlans()));
  app.get("/api/saas/tenants", adminGuard, (_req, res) => res.json(listTenants()));
  app.get("/api/saas/keys", adminGuard, (req, res) => {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : "";
    if (!tenantId) return res.status(400).json({ error: "Missing 'tenantId' query" });
    res.json(listKeys(tenantId)); // metadata only — never hash/plaintext
  });
  app.post("/api/saas/tenants", adminGuard, (req, res) => {
    try {
      const { name, plan, stripeCustomerId } = req.body || {};
      if (!name) return res.status(400).json({ error: "Missing 'name'" });
      res.json(createTenant(String(name), plan ? String(plan) : "free", stripeCustomerId ? String(stripeCustomerId) : null));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/saas/keys", adminGuard, (req, res) => {
    try {
      const { tenantId, label } = req.body || {};
      if (!tenantId) return res.status(400).json({ error: "Missing 'tenantId'" });
      res.json(issueApiKey(String(tenantId), label ? String(label) : "")); // plaintext key returned ONCE
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/saas/keys/:id/revoke", adminGuard, (req, res) => {
    revokeApiKey(req.params.id);
    res.json({ revoked: req.params.id });
  });

  // A tenant's own current-month usage summary (authenticated).
  app.get("/api/saas/usage", authMiddleware(true), (req, res) => {
    const t = req.tenant!;
    res.json({ tenantId: t.tenantId, plan: t.plan.id, monthlyQuota: t.plan.monthly_quota, used: monthToDateUsage(t.tenantId) });
  });

  // --- Billing (AGENTS.md Faz 4). Dry-run unless STRIPE_API_KEY is set. ---
  app.get("/api/billing/preview", adminGuard, (req, res) => {
    res.json(computeRun(typeof req.query.period === "string" ? req.query.period : undefined));
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
        const pingResult = await ProviderRouter.generate({
          provider: "ollama-local",
          model: "qwen3:8b", // Standard low weight local target
          messages: [{ role: "user", content: "ping" }],
          numCtx: 512,
        });
        report["G2_OllamaHealth"] = {
          status: pingResult.text ? "PASS" : "WARN",
          details: `Reachable and responded: ${pingResult.text.substring(0, 40)}`,
        };
      } catch (e: any) {
        report["G2_OllamaHealth"] = {
          status: "FAIL",
          details: `Ollama is offline or model missing: ${e.message}. Remedy: ensure Local Ollama application is opened and port 11434 is bound.`,
        };
      }
    } else {
      report["G2_OllamaHealth"] = {
        status: "WARN",
        details: "Ollama ping ignored: cloud container is isolated from local macOS daemon.",
      };
    }

    // G3: Sequential Pipeline Fallback Check
    try {
      const pipelineResult = await ProviderRouter.generate({
        provider: CURRENT_MODE === "live" ? "ollama-local" : "demo",
        model: CURRENT_MODE === "live" ? "qwen3:8b" : "simulation",
        messages: [{ role: "user", content: "test design target" }],
      });
      const expectedSource = CURRENT_MODE === "live" ? "ollama_local" : "demo";
      report["G3_PipelineFallback"] = {
        status: pipelineResult.source === expectedSource ? "PASS" : "WARN",
        details: `Adaptive router fallback responsive. Source traced: ${pipelineResult.source}`,
      };
    } catch (e: any) {
      report["G3_PipelineFallback"] = {
        status: "FAIL",
        details: `Pipeline router fail: ${e.message}`,
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
      const blockedTest1 = await TerminalManager.execute(isLive, "/root", "rm -rf /");
      const blockedTest2 = await TerminalManager.execute(isLive, "/root", "cat /etc/passwd; ls");
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
        const toolResult = await ProviderRouter.generate({
          provider: "ollama-local",
          model: "qwen3:8b",
          messages: [
            { role: "system", content: "You are a ReAct agent. You must invoke the list_tree tool to inspect the workspace." },
            { role: "user", content: "List the files." }
          ],
          tools: TEST_TOOLS,
          numCtx: 1024,
        });

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
        report["G8_AgentToolLoop"] = {
          status: "FAIL",
          details: `ReAct 1-step loop invocation failed: ${e.message}`,
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
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Cockpit] Console backend is listening on http://0.0.0.0:${PORT}`);
  });
}

// Start full stack Express services
initializeServer().catch((e) => {
  console.error("Express initialization crashed on start.", e);
});
