#!/usr/bin/env node
// odysseus-bridge-mcp — thin stdio MCP server that lets ollamas CONSUME a local
// Odysseus instance (github.com/pewdiepie-archdaemon/odysseus) as upstream tools.
//
// Odysseus does not EXPOSE MCP itself (it only consumes), so this wrapper maps a
// small tool surface onto its HTTP API:
//   odysseus_health      GET  /api/health
//   odysseus_chat        POST /api/session + /api/chat_stream (mode=chat)
//   odysseus_agent_task  POST /api/session + /api/chat_stream (mode=agent, workspace-confined)
//   odysseus_research    POST /api/session + /api/chat_stream (use_research=true)
//
// CONTRACT: stdout is reserved for the MCP JSON-RPC stream — diagnostics to stderr.
// The Odysseus base URL is a dynamic Pinokio port, so it is NEVER hardcoded:
// pass ODYSSEUS_URL in the upstream env (tools.json), default http://127.0.0.1:7860.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.ODYSSEUS_URL || "http://127.0.0.1:7860").replace(/\/+$/, "");
const ENDPOINT_ID = process.env.ODYSSEUS_ENDPOINT_ID || ""; // model-endpoint row in Odysseus
const DEFAULT_MODEL = process.env.ODYSSEUS_MODEL || "qwen3:8b";
const CHAT_TIMEOUT_MS = Number(process.env.ODYSSEUS_CHAT_TIMEOUT_MS || 300_000);
const RESEARCH_TIMEOUT_MS = Number(process.env.ODYSSEUS_RESEARCH_TIMEOUT_MS || 900_000);

// One bridge session per (model, mode) so repeated calls reuse context cheaply.
const sessionCache = new Map();
// Long-lived agent sessions accumulate completed-task history until the model
// starts imitating past answers instead of issuing real tool calls (silent
// "simulated exec": narrates success, writes nothing). Rotate after N uses.
const sessionUses = new Map();
const AGENT_SESSION_MAX_USES = Number(process.env.ODYSSEUS_AGENT_SESSION_MAX_USES || 6);

async function createSession(model) {
  // When pinned to a specific Odysseus endpoint, the caller's generic model
  // ("ollamas-auto", forced by ollamas server) is invalid for that endpoint and
  // degrades tool-calling (loops back, returns tool calls as text). Use the
  // endpoint's configured DEFAULT_MODEL so native function-calling works.
  const effModel = ENDPOINT_ID ? DEFAULT_MODEL : model;
  const form = new FormData();
  form.set("name", `ollamas-bridge-${effModel}`);
  if (ENDPOINT_ID) form.set("endpoint_id", ENDPOINT_ID);
  else form.set("skip_validation", "true");
  form.set("model", effModel);
  const r = await fetch(`${BASE}/api/session`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`odysseus /api/session ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (!j.id) throw new Error(`odysseus session create returned no id: ${JSON.stringify(j)}`);
  return j.id;
}

async function getSession(model, mode, lane) {
  // Research runs over mode="chat" too, so keying on mode alone made the plain
  // chat tool and the research tool share one session — research reports then
  // bled into chat answers. Separate them with an explicit lane.
  const key = `${model}::${mode}::${lane || "c"}`;
  if (sessionCache.has(key)) {
    if (mode === "agent") {
      const uses = (sessionUses.get(key) || 0) + 1;
      if (uses >= AGENT_SESSION_MAX_USES) {
        sessionCache.delete(key);
        sessionUses.delete(key);
      } else {
        sessionUses.set(key, uses);
        return sessionCache.get(key);
      }
    } else {
      return sessionCache.get(key);
    }
  }
  const id = await createSession(model);
  sessionCache.set(key, id);
  sessionUses.set(key, 1);
  return id;
}

// Stream /api/chat_stream and fold the SSE deltas into { answer, thinking }.
async function chatStream(opts) {
  const { message, model, mode, workspace, useResearch, timeoutMs } = opts;
  const session = await getSession(model, mode, useResearch ? "research" : mode);
  const form = new FormData();
  form.set("message", message);
  form.set("session", session);
  form.set("mode", mode);
  if (workspace) form.set("workspace", workspace);
  if (useResearch) form.set("use_research", "true");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`odysseus stream timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    let r = await fetch(`${BASE}/api/chat_stream`, { method: "POST", body: form, signal: ctrl.signal });
    if (!r.ok || !r.body) {
      // Try to recover from 404 SESSION_NOT_FOUND
      if (r.status === 404) {
        const text = await r.text();
        if (text.includes("SESSION_NOT_FOUND")) {
          // Delete stale session and retry once
          const sessionKey = `${model}::${mode}::${useResearch ? "research" : mode}`;
          sessionCache.delete(sessionKey);
          const newSession = await getSession(model, mode, useResearch ? "research" : mode);
          form.set("session", newSession);
          const retryR = await fetch(`${BASE}/api/chat_stream`, { method: "POST", body: form, signal: ctrl.signal });
          if (!retryR.ok || !retryR.body) throw new Error(`odysseus /api/chat_stream retry ${retryR.status}: ${await retryR.text()}`);
          r = retryR;
        } else {
          throw new Error(`odysseus /api/chat_stream ${r.status}: ${text}`);
        }
      } else {
        throw new Error(`odysseus /api/chat_stream ${r.status}: ${await r.text()}`);
      }
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", answer = "", thinking = 0, events = [], errored = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue; // ": heartbeat N" keepalives
        let chunk;
        try { chunk = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (typeof chunk.delta === "string") {
          if (chunk.thinking) thinking += chunk.delta.length;
          else answer += chunk.delta;
        } else if (chunk.type && chunk.type !== "model_info") {
          // tool calls, research progress/sources, errors — keep a compact trace
          events.push(chunk.type);
          if (chunk.type === "error") {
            errored = true;
            answer += `\n[odysseus error] ${JSON.stringify(chunk.data ?? chunk)}`;
          }
        }
      }
    }
    answer = answer.trim();
    // Research mode emits `research_done` then closes the stream WITHOUT streaming
    // the synthesized answer as deltas — odysseus saves it as an assistant message
    // for the frontend to fetch separately. Recover it from session history so the
    // bridge returns the real research result instead of an empty answer.
    if (!answer && (useResearch || events.includes("research_done"))) {
      answer = await fetchLastAssistant(session, timeoutMs);
    }
    return { session, answer, thinkingChars: thinking, events: [...new Set(events)], errored };
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/history/{session} → last assistant message content (research recovery).
async function fetchLastAssistant(session, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs ?? 15000, 15000));
  try {
    const r = await fetch(`${BASE}/api/history/${encodeURIComponent(session)}`, { signal: ctrl.signal });
    if (!r.ok) return "";
    const j = await r.json();
    const msgs = Array.isArray(j) ? j : (j.messages || j.history || []);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
        return m.content.trim();
      }
    }
    return "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

const server = new McpServer({ name: "odysseus-bridge", version: "1.0.0" });

server.tool(
  "odysseus_health",
  "Check that the local Odysseus workspace is up. Returns its /api/health JSON.",
  {},
  async () => {
    const r = await fetch(`${BASE}/api/health`);
    return { content: [{ type: "text", text: `${r.status} ${await r.text()}` }] };
  },
);

server.tool(
  "odysseus_chat",
  "Ask the local Odysseus AI workspace (local LLM) a question and return its final answer.",
  {
    prompt: z.string().describe("The question or instruction for Odysseus"),
    model: z.string().optional().describe(`Model name (default ${DEFAULT_MODEL})`),
  },
  async ({ prompt, model }) => {
    const res = await chatStream({
      message: prompt, model: model || DEFAULT_MODEL, mode: "chat", timeoutMs: CHAT_TIMEOUT_MS,
    });
    return { content: [{ type: "text", text: res.answer || "(empty answer)" }] };
  },
);

server.tool(
  "odysseus_agent_task",
  "Run an Odysseus autonomous agent task (tool-using loop) confined to a workspace directory.",
  {
    task: z.string().describe("The task for the Odysseus agent"),
    workspace: z.string().optional().describe("Directory to confine the agent's file tools to"),
    model: z.string().optional().describe(`Model name (default ${DEFAULT_MODEL})`),
  },
  async ({ task, workspace, model }) => {
    const res = await chatStream({
      message: task, model: model || DEFAULT_MODEL, mode: "agent",
      workspace: workspace || process.env.ODYSSEUS_AGENT_WORKSPACE || undefined,
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    const trace = res.events.length ? `\n\n[events: ${res.events.join(", ")}]` : "";
    return { content: [{ type: "text", text: (res.answer || "(empty answer)") + trace }] };
  },
);

server.tool(
  "odysseus_research",
  "Run Odysseus DeepResearch (SearXNG-backed, multi-source) and return the final report text.",
  {
    query: z.string().describe("Research question"),
    model: z.string().optional().describe(`Model name (default ${DEFAULT_MODEL})`),
  },
  async ({ query, model }) => {
    const res = await chatStream({
      message: query, model: model || DEFAULT_MODEL, mode: "chat", useResearch: true,
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    const trace = res.events.length ? `\n\n[events: ${res.events.join(", ")}]` : "";
    return { content: [{ type: "text", text: (res.answer || "(empty answer)") + trace }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[odysseus-bridge] stdio MCP ready — base=${BASE} model=${DEFAULT_MODEL}\n`);
