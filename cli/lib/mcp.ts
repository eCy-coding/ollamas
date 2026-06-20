// MCP client helpers — pure functions, unit-testable without a socket.
// Patterns ported (zero-dep TS) from the MIT projects f/mcptools (subcommand
// shape, tool-signature render, guard glob) and jonigl/mcp-client-for-ollama
// (HIL danger gate). The JSON-RPC 2.0 envelope is the language-agnostic MCP spec
// asset. The gateway's /mcp is STATELESS (no initialize handshake, no session
// id) and replies as text/event-stream — proven by live probe (server.ts:1300).
import { parseSSEBuffer } from "./client";
import { c, type OutputCtx } from "./output";

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, any>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
}

// JSON-RPC 2.0 request envelope (MCP spec, verbatim shape).
export function rpcEnvelope(id: number, method: string, params: Record<string, any> = {}) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

// Parse a /mcp response body. Streamable HTTP replies as SSE (`event: message\n
// data: {…}\n\n`) but may also reply as bare JSON — handle both. Returns the
// last JSON-RPC envelope ({result} | {error}).
export function parseRpcResponse(body: string): { result?: any; error?: any } {
  const text = body.trim();
  if (!text) throw new Error("empty MCP response");
  if (text.includes("data:")) {
    // SSE-framed — reuse the chat SSE splitter; the final event holds the result.
    const { events } = parseSSEBuffer(text.endsWith("\n\n") ? text : text + "\n\n");
    const last = events[events.length - 1];
    if (!last) throw new Error("no JSON-RPC frame in MCP stream");
    return last;
  }
  return JSON.parse(text);
}

// A tool is "dangerous" → HIL gate fires (J5) when it can mutate or reach the
// open world. write-tier tools carry destructiveHint/openWorldHint (live probe).
export function toolDanger(tool: McpTool): boolean {
  const a = tool.annotations || {};
  return a.destructiveHint === true || a.openWorldHint === true;
}

// Glob match: only `*` is special (any run of chars). Anchored full match.
// Ported from mcptools guard. Pure.
export function globMatch(pattern: string, name: string): boolean {
  const rx = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$");
  return rx.test(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Apply a local allow/deny guard over a tool list (mcptools guard semantics):
// allow (if any) is a whitelist; deny always removes. Both are glob CSV-derived.
export function filterByGuard<T extends { name: string }>(tools: T[], allow: string[], deny: string[]): T[] {
  return tools.filter((t) => {
    if (allow.length && !allow.some((p) => globMatch(p, t.name))) return false;
    if (deny.some((p) => globMatch(p, t.name))) return false;
    return true;
  });
}

// man-page style signature: `name(req:type, [opt:type])` — required params green,
// optional ones yellow in [brackets]. Ported from mcptools' tool render.
export function formatToolSignature(tool: McpTool, ctx: OutputCtx): string {
  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const parts = Object.keys(props).map((k) => {
    const type = props[k]?.type || "any";
    return required.has(k)
      ? c("green", `${k}:${type}`, ctx.color)
      : c("yellow", `[${k}:${type}]`, ctx.color);
  });
  return `${c("cyan", tool.name, ctx.color)}(${parts.join(", ")})`;
}

// Coerce a raw `--arg k=v` string value to a typed value per the tool schema
// (number/boolean/integer), else try JSON, else keep the string. Pure.
export function coerceArg(value: string, schemaType?: string): any {
  if (schemaType === "number" || schemaType === "integer") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  if (schemaType === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (schemaType === "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Build a tool-call arguments object from repeated `k=v` pairs, typed via schema.
export function argsFromPairs(pairs: string[], tool?: McpTool): Record<string, any> {
  const props = tool?.inputSchema?.properties || {};
  const out: Record<string, any> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    out[k] = coerceArg(v, props[k]?.type);
  }
  return out;
}

// An MCP `notifications/progress` payload (spec shape). `total` and `message`
// are optional; `progress` is monotonically increasing.
export interface McpProgress {
  progress?: number;
  total?: number;
  message?: string;
  progressToken?: string | number;
}

// Render a one-line progress indicator: `⟳ 3/10 (30%) building…` — percent only
// when total is known. Pure → unit-testable. Caller decides the stream (stderr).
export function formatProgress(p: McpProgress, ctx: OutputCtx): string {
  const cur = typeof p.progress === "number" ? p.progress : 0;
  const frac = typeof p.total === "number" && p.total > 0 ? ` (${Math.round((cur / p.total) * 100)}%)` : "";
  const tot = typeof p.total === "number" ? `/${p.total}` : "";
  const msg = p.message ? ` ${p.message}` : "";
  return c("dim", `⟳ ${cur}${tot}${frac}${msg}`, ctx.color);
}

// Flatten an MCP tools/call result `content[]` to plain text for the terminal.
export function renderToolResult(result: { content?: any[]; isError?: boolean }): string {
  const parts = (result.content || []).map((p) =>
    p?.type === "text" ? String(p.text ?? "") : JSON.stringify(p),
  );
  return parts.join("\n");
}

// --- resources + prompts (v14) — the other half of the MCP spec surface the
// gateway exposes (server/mcp/server.ts). Same JSON-RPC plumbing as tools. ---

export interface McpResource {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArg {
  name: string;
  description?: string;
  required?: boolean;
}
export interface McpPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArg[];
}

// Flatten a resources/read result `contents[]` to text. Text contents print raw; a
// binary blob is summarized (not dumped) so the terminal stays readable.
export function renderResourceContents(result: { contents?: any[] }): string {
  const parts = (result.contents || []).map((p) => {
    if (typeof p?.text === "string") return p.text;
    if (typeof p?.blob === "string") return `[blob ${p.mimeType || "application/octet-stream"}, ${p.blob.length} base64 chars]`;
    return JSON.stringify(p);
  });
  return parts.join("\n");
}

// Render a prompts/get result (a templated message chain) as `role: text` lines.
export function renderPromptMessages(result: { messages?: any[]; description?: string }): string {
  const lines: string[] = [];
  if (result.description) lines.push(`# ${result.description}`);
  for (const m of result.messages || []) {
    const role = m?.role || "?";
    const ct = m?.content;
    const text = ct?.type === "text" ? String(ct.text ?? "") : typeof ct === "string" ? ct : JSON.stringify(ct);
    lines.push(`${role}: ${text}`);
  }
  return lines.join("\n");
}

// Prompt signature `name(req, [opt])` — required args green, optional in [brackets].
// Mirrors formatToolSignature but over prompt arguments (which are plain strings).
export function formatPromptSignature(p: McpPrompt, ctx: OutputCtx): string {
  const parts = (p.arguments || []).map((a) =>
    a.required ? c("green", a.name, ctx.color) : c("yellow", `[${a.name}]`, ctx.color),
  );
  return `${c("cyan", p.name, ctx.color)}(${parts.join(", ")})`;
}

// Build a prompts/get arguments object from repeated `k=v` pairs. Prompt arguments
// are strings per the MCP spec — no schema coercion (unlike tool args).
export function promptArgsFromPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}
