// MCP client (CONSUME side, AGENTS.md Faz 1 + 6B hardening). Connects to upstream
// MCP servers, lists their tools, and merges each into the single ToolRegistry
// choke-point under a namespaced name `mcp__<server>__<tool>`. After connecting,
// the ReAct agent and the /mcp expose layer can call upstream tools transparently.
//
// Faz 6B (untrusted-upstream hardening, MCP security best-practices):
//  - Upstream tools register at the `host_upstream` tier → excluded from default
//    MCP expose so a rogue server can't reach tenants without explicit opt-in.
//  - Per-upstream `allowedTools` allowlist + reject names that collide with
//    built-ins (defense even though the mcp__ namespace already separates them).
//  - Output sanitization strips prompt-injection markers before the text reaches
//    the agent history.
//  - Manifest hash (name+description) pins the tool set; a changed manifest on
//    reconnect is flagged (rug-pull / tool-poisoning detection).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CreateMessageRequestSchema, ListRootsRequestSchema, ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { ToolRegistry } from "../tool-registry";
import { ProviderRouter } from "../providers";
import { db } from "../db";

// Faz 20A: consume-side ROOTS. ollamas (as an MCP CLIENT to an upstream) advertises
// the `roots` capability and answers the upstream's roots/list with its workspace
// root — a sandbox signal so a well-behaved upstream (e.g. a filesystem server)
// can scope its operations to our workspace. Read-only, always safe to advertise.
function registerRootsHandler(client: Client): void {
  client.setRequestHandler(ListRootsRequestSchema, async () => {
    const root = db.data.workspacePath;
    return root ? { roots: [{ uri: pathToFileURL(root).href, name: "workspace" }] } : { roots: [] };
  });
}

// Faz 18C: consume-side SAMPLING provider. When MCP_SAMPLING=1, ollamas (acting as
// an MCP CLIENT to an upstream) answers the upstream's `sampling/createMessage`
// requests with its OWN LLM via ProviderRouter — making the gateway a sampling
// host. Default OFF: without the env the `sampling` capability is not advertised,
// so an untrusted upstream cannot spend our LLM. Inbound prompts are sanitized.
const SAMPLING_ENABLED = () => process.env.MCP_SAMPLING === "1";

function registerSamplingHandler(client: Client): void {
  client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
    const p: any = req.params || {};
    const toText = (c: any) => (c && c.type === "text" && typeof c.text === "string" ? c.text : "");
    const messages = (p.messages || []).map((m: any) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: sanitizeUpstreamOutput(toText(m.content)),
    }));
    if (p.systemPrompt) messages.unshift({ role: "user" as const, content: sanitizeUpstreamOutput(String(p.systemPrompt)) });
    const result = await ProviderRouter.generate({
      provider: process.env.MCP_SAMPLING_PROVIDER || "ollama-local",
      model: process.env.MCP_SAMPLING_MODEL || "llama3.2",
      messages,
    });
    return { role: "assistant", content: { type: "text", text: result.text }, model: result.modelUsed, stopReason: "endTurn" };
  });
}

// v1.9 upstream security-scan gate (opt-in, dry-run-capable — mirrors the Stripe
// no-op-without-config philosophy). When MCP_SCAN_CMD is set, a discovered
// upstream's tool manifest is piped to that external scanner (e.g.
// cisco-ai-defense/mcp-scanner) BEFORE registration; flagged tools are skipped.
// This is defense-in-depth ON TOP OF manifest pinning + output sanitization + the
// host_upstream tier — so a scanner that errors fails OPEN (logs, does not block).
async function scanUpstreamTools(
  server: string,
  tools: { name: string; description?: string; inputSchema?: unknown }[]
): Promise<Set<string>> {
  const cmd = process.env.MCP_SCAN_CMD;
  if (!cmd) return new Set();
  const timeoutMs = Number(process.env.MCP_SCAN_TIMEOUT_MS) || 10000;
  const manifest = JSON.stringify({ server, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  return new Promise<Set<string>>((resolve) => {
    let done = false;
    const finish = (names: string[]) => { if (!done) { done = true; resolve(new Set(names)); } };
    try {
      const child = spawn(cmd, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
      let out = "";
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} console.warn(`[MCP-Scan] ${server}: scanner timed out — failing open.`); finish([]); }, timeoutMs);
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.on("error", (e) => { clearTimeout(timer); console.warn(`[MCP-Scan] ${server}: scanner spawn error (${e.message}) — failing open.`); finish([]); });
      child.on("close", () => {
        clearTimeout(timer);
        try { finish(Array.isArray(JSON.parse(out).flagged) ? JSON.parse(out).flagged : []); }
        catch { console.warn(`[MCP-Scan] ${server}: unparsable scanner output — failing open.`); finish([]); }
      });
      child.stdin.write(manifest); child.stdin.end();
    } catch (e: any) { console.warn(`[MCP-Scan] ${server}: scanner error (${e?.message}) — failing open.`); finish([]); }
  });
}

export interface UpstreamConfig {
  name: string;
  transport: "stdio" | "http";
  /** stdio: executable + args. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http: server URL. */
  url?: string;
  /** http: extra request headers (e.g. a bearer token for a local, key-authenticated server). */
  headers?: Record<string, string>;
  /**
   * http: PEM to pin as the CA for this upstream. Lets us talk to a loopback server that mints
   * its own certificate (Obsidian's Local REST API) with verification left ON — the alternative
   * would be disabling TLS checks or dropping to plaintext, and neither is acceptable.
   */
  ca?: string;
  /** Only register these upstream tool names (raw, un-namespaced). Empty = all. */
  allowedTools?: string[];
}

export interface UpstreamResult {
  name: string;
  ok: boolean;
  tools: number;
  skipped?: string[];
  manifestChanged?: boolean;
  /** Whether an external security scan ran (MCP_SCAN_CMD set). */
  scanned?: boolean;
  /** Raw tool names the scanner flagged (skipped unless MCP_SCAN_DRY_RUN=1). */
  flagged?: string[];
  /** Raw (un-namespaced) tool names actually registered (Faz 27 — supervisor health/collisions). */
  toolNames?: string[];
  error?: string;
}

const clients = new Map<string, Client>();
// Pinned manifest hash per upstream — detects tool-set tampering across reconnects.
const manifestHashes = new Map<string, string>();
// Per-upstream roots fetched after connect (v1.11 Phase A expose-side aggregation).
const upstreamRoots = new Map<string, { uri: string; name: string }[]>();

/** Flatten all stored upstream roots, namespacing name as "<server>:<name>".
 *  Best-effort: never throws. An upstream that does not support roots is stored as []. */
export function getFederatedRoots(): { uri: string; name: string }[] {
  const result: { uri: string; name: string }[] = [];
  for (const [server, roots] of upstreamRoots) {
    for (const r of roots) {
      result.push({ uri: r.uri, name: `${server}:${r.name}` });
    }
  }
  return result;
}

/** Strip prompt-injection markers from untrusted upstream text before it reaches
 *  the agent's conversation (defense against tool-output prompt injection). */
export function sanitizeUpstreamOutput(text: string): string {
  if (!text) return text;
  return text
    // Neutralize fake chat-role / tool-call framing an upstream might inject.
    .replace(/^\s*(system|assistant|developer)\s*:/gim, "[upstream] $1:")
    .replace(/"(role|tool_call_id|tool_calls)"\s*:/gi, '"_$1":')
    .replace(/<\/?(system|assistant|tool_call|function)\b[^>]*>/gi, "");
}

const builtinNames = new Set(ToolRegistry.list().filter(t => t.tier !== "host_upstream").map(t => t.name));

// One undici Agent per pinned CA — rebuilding a TLS context per request would be wasteful,
// and the transport calls fetch many times over a session's lifetime.
const caDispatchers = new Map<string, UndiciAgent>();
/** fetch that trusts exactly one extra CA. Used for loopback servers with self-signed certs. */
export function caPinnedFetch(ca: string): typeof undiciFetch {
  let agent = caDispatchers.get(ca);
  if (!agent) { agent = new UndiciAgent({ connect: { ca } }); caDispatchers.set(ca, agent); }
  return ((url: any, init: any) => undiciFetch(url, { ...(init || {}), dispatcher: agent })) as typeof undiciFetch;
}

/** Connect one upstream MCP server and register its tools. Never throws. When
 *  `owner` (a tenantId) is given, the merged tools are tenant-scoped (Faz 24):
 *  visible to and invokable by only that tenant. Omit for global/shared upstreams. */
export async function connectUpstream(cfg: UpstreamConfig, owner?: string): Promise<UpstreamResult> {
  // FIX B1: hoisted above the try so a timed-out/failed connect can still be
  // closed from the catch below. Every SDK call the SDK makes defaults to a
  // 60s timeout, so three unguarded sequential calls (connect/listTools/
  // roots-list) could previously burn up to 180s on one dead upstream — and,
  // for stdio, leave the spawned child process running forever.
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;
  try {
    const samplingOn = SAMPLING_ENABLED();
    const client = new Client(
      { name: "ollamas-gateway", version: "0.1.0" },
      { capabilities: { roots: { listChanged: false }, ...(samplingOn ? { sampling: {} } : {}) } }
    );
    if (samplingOn) registerSamplingHandler(client);
    registerRootsHandler(client); // Faz 20A: advertise our workspace root to upstreams

    // NOTE (SSRF residual): tenant-supplied cfg.url is host-classified by
    // validateUpstreamConfig before we reach here, but this transport re-resolves
    // the hostname at connect time — a DNS-rebind (public at check, private at
    // connect) is not pinned. Closing it needs a custom fetch/agent that pins the
    // vetted IP; tracked as a documented residual, not silently ignored.
    transport =
      cfg.transport === "stdio"
        ? new StdioClientTransport({ command: cfg.command!, args: cfg.args || [], env: cfg.env })
        : new StreamableHTTPClientTransport(new URL(cfg.url!), {
            ...(cfg.headers ? { requestInit: { headers: cfg.headers } } : {}),
            // A pinned CA needs its own dispatcher, so the transport gets a fetch that carries
            // it. Verification stays enabled — this widens *who* we trust, not *whether* we check.
            ...(cfg.ca ? { fetch: caPinnedFetch(cfg.ca) as any } : {}),
          });

    // FIX B1: explicit bounded timeouts — a dead/hung upstream must fail fast
    // instead of inheriting the SDK's 60s-per-call default.
    const connectTimeoutMs = Number(process.env.MCP_CONNECT_TIMEOUT_MS) || 15000;
    await client.connect(transport, { timeout: connectTimeoutMs });
    const { tools } = await client.listTools(undefined, { timeout: 10000 });

    // Pin the manifest (sorted name+description) and flag changes vs a prior connect.
    const manifest = tools.map((t) => `${t.name} ${t.description || ""}`).sort().join("");
    const hash = crypto.createHash("sha256").update(manifest).digest("hex");
    const prior = manifestHashes.get(cfg.name);
    const manifestChanged = prior !== undefined && prior !== hash;
    if (manifestChanged) console.warn(`[MCP-Consume] ${cfg.name}: tool manifest CHANGED since last connect (possible rug-pull) — review before trusting.`);
    manifestHashes.set(cfg.name, hash);

    // Optional external security scan (v1.9). Flagged tools are skipped unless
    // MCP_SCAN_DRY_RUN=1, in which case they are reported but still registered.
    const scanned = !!process.env.MCP_SCAN_CMD;
    const dryRun = process.env.MCP_SCAN_DRY_RUN === "1";
    const flagged = scanned ? await scanUpstreamTools(cfg.name, tools) : new Set<string>();
    if (flagged.size) console.warn(`[MCP-Scan] ${cfg.name}: flagged [${[...flagged].join(", ")}]${dryRun ? " (dry-run — registering anyway)" : " — skipping"}.`);

    const allow = cfg.allowedTools && cfg.allowedTools.length ? new Set(cfg.allowedTools) : null;
    const skipped: string[] = [];
    const registeredNames: string[] = [];
    let registered = 0;

    for (const t of tools) {
      if (allow && !allow.has(t.name)) { skipped.push(t.name); continue; }
      if (flagged.has(t.name) && !dryRun) { skipped.push(`${t.name} (flagged by security scan)`); continue; }
      const toolName = `mcp__${cfg.name}__${t.name}`;
      if (builtinNames.has(toolName)) { skipped.push(`${t.name} (name collision)`); continue; }

      ToolRegistry.register(toolName, {
        // Untrusted upstream → host_upstream tier (not in default MCP expose).
        tier: "host_upstream",
        schema: {
          type: "function",
          function: {
            name: toolName,
            description: t.description || `${cfg.name}: ${t.name}`,
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
        },
        invoke: async (args: any, ctx: any) => {
          // Faz 20B: thread the caller's cooperative-cancellation signal into the
          // upstream call so an MCP CancelledNotification actually aborts the
          // in-flight upstream request (SDK callTool 3rd arg = RequestOptions).
          const r: any = await client.callTool({ name: t.name, arguments: args || {} }, undefined, { signal: ctx?.abortSignal });
          const raw = Array.isArray(r?.content)
            ? r.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n")
            : JSON.stringify(r);
          const text = sanitizeUpstreamOutput(raw);
          // Propagate upstream failure so the choke-point records ok=false.
          if (r?.isError) throw new Error(text || `Upstream tool ${cfg.name}:${t.name} failed`);
          return text;
        },
      }, owner); // Faz 24: tenant-scope the tool when owner is set
      registeredNames.push(t.name);
      registered++;
    }

    clients.set(cfg.name, client);

    // v1.11 Phase A: fetch upstream roots for expose-side aggregation. Best-effort —
    // an upstream that does not implement roots/list will reject → store [].
    try {
      const { roots: fetchedRoots } = await client.request({ method: "roots/list" }, ListRootsResultSchema, { timeout: 5000 });
      upstreamRoots.set(cfg.name, (fetchedRoots || []).map((r) => ({ uri: r.uri, name: r.name || r.uri })));
    } catch {
      upstreamRoots.set(cfg.name, []);
    }

    return {
      name: cfg.name, ok: true, tools: registered, toolNames: registeredNames,
      skipped: skipped.length ? skipped : undefined, manifestChanged,
      ...(scanned ? { scanned: true } : {}),
      ...(flagged.size ? { flagged: [...flagged] } : {}),
    };
  } catch (err: any) {
    // FIX B1: a connect/listTools/registration failure must not leak the spawned
    // upstream process (stdio) or dangling connection (http). Best-effort — never
    // let a close() failure mask or replace the original connect error.
    try { await transport?.close(); } catch { /* best-effort */ }
    return { name: cfg.name, ok: false, tools: 0, error: err?.message || String(err) };
  }
}

/** Connect all configured upstreams; best-effort, returns per-server status. When
 *  `owner` is given, every merged tool is tenant-scoped to it (Faz 24). */
export async function connectAllUpstreams(configs: UpstreamConfig[], owner?: string): Promise<UpstreamResult[]> {
  return Promise.all(configs.map((c) => connectUpstream(c, owner)));
}

export function listUpstreams(): string[] {
  return [...clients.keys()];
}

/** Health probe for a connected upstream (Faz 27): a successful tools/list = alive. */
export async function pingUpstream(name: string): Promise<boolean> {
  const c = clients.get(name);
  if (!c) return false;
  try { await c.listTools(); return true; } catch { return false; }
}

/** Close + forget an upstream connection (Faz 27 — reconnect/remove). Best-effort. */
export async function disconnectUpstream(name: string): Promise<void> {
  const c = clients.get(name);
  if (!c) return;
  try { await c.close(); } catch { /* best effort */ }
  clients.delete(name);
}
