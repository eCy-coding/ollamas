// MCP server (EXPOSE side, Faz 1 + 10A). Publishes the workspace tools from the
// single ToolRegistry choke-point over Streamable HTTP at /mcp. v1.1 completes the
// protocol surface: per-tenant tool visibility, cursor pagination, workspace
// `resources`, and progress notifications for long tool calls.
//
// Stateless transport: a fresh Server+transport per request; per-tenant context
// is supplied by the caller via ctxFactory.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, CompleteRequestSchema,
  SetLevelRequestSchema, ListRootsRequestSchema,
  SubscribeRequestSchema, UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import type { Request, Response } from "express";
import { ToolRegistry, type ToolCtx, type ToolTier } from "../tool-registry";
import { PROMPTS, getPrompt, completeArg } from "./prompts";
import { getFederatedRoots } from "./client";
import { SubscriptionRegistry } from "./subscriptions";
import { flattenTreeFiles } from "../files";

/** Builds a per-request ToolCtx (tenant, deps, allowlist, metering). */
export type CtxFactory = (req: Request) => ToolCtx;

const PAGE = 50;
const encodeCursor = (n: number) => Buffer.from(String(n)).toString("base64");
const decodeCursor = (c?: string) => (c ? parseInt(Buffer.from(c, "base64").toString(), 10) || 0 : 0);

// Single source of truth for the gateway's MCP identity. server.json, the
// /.well-known/mcp.json discovery doc, and the live Server handshake all read
// these — keeping them here prevents version/capability drift (Faz 15A).
export const MCP_SERVER_NAME = "ollamas-gateway";
export const MCP_SERVER_VERSION = "1.6.0";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
// Advertise only what we implement (Faz 14A): tools/resources/prompts/
// completions + structured logging. listChanged is false (stateless transport).
export const MCP_CAPABILITIES = {
  tools: { listChanged: false }, resources: { subscribe: true }, prompts: {}, completions: {}, logging: {}, roots: {},
} as const;

// RFC 5424 severities, MCP logging order (low → high). A message is sent when its
// severity is at or above the connection's current level.
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];
const rank = (l: string) => { const i = LOG_LEVELS.indexOf(l as LogLevel); return i < 0 ? 1 : i; };

export function buildServer(ctx: ToolCtx): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { ...MCP_CAPABILITIES } }
  );

  // WHY here: stdio = persistent connection → sendResourceUpdated reaches the
  // client. HTTP = stateless per-request → subscribe is accepted (spec compliant)
  // but the channel closes with the response (best-effort); watchers disposed via
  // onclose so no fd leak regardless of transport.
  const subscriptions = new SubscriptionRegistry(ctx.workspaceRoot, (uri) => {
    server.sendResourceUpdated({ uri }).catch(() => {});
  });
  server.onclose = () => subscriptions.dispose();

  const allowed: ToolTier[] | undefined = ctx.allowedTiers;

  // Per-connection log level (stateless transport → per request). Base from env;
  // logging/setLevel raises/lowers it for the rest of this connection.
  let logLevel: LogLevel = (process.env.MCP_LOG_LEVEL as LogLevel) || "info";
  const emitLog = (level: LogLevel, data: unknown): Promise<void> => {
    if (rank(level) < rank(logLevel)) return Promise.resolve();
    return server.notification({ method: "notifications/message", params: { level, logger: "ollamas", data } }).catch(() => {});
  };

  // --- logging/setLevel (Faz 14A) ---
  server.setRequestHandler(SetLevelRequestSchema, async (req) => {
    const lvl = String(req.params?.level || "");
    if (LOG_LEVELS.includes(lvl as LogLevel)) logLevel = lvl as LogLevel;
    return {};
  });

  // --- roots/list (v1.11 Phase A): workspace root + federated upstream roots ---
  server.setRequestHandler(ListRootsRequestSchema, async () => {
    const workspacePath = (await import("../db")).db.data.workspacePath;
    const workspace = workspacePath
      ? [{ uri: pathToFileURL(workspacePath).href, name: "workspace" }]
      : [];
    const federated = getFederatedRoots();
    return { roots: [...workspace, ...federated] };
  });

  // --- tools/list (per-tenant visibility + cursor pagination) ---
  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    const all = ToolRegistry.list(allowed, ctx.tenantId);
    const start = decodeCursor(req.params?.cursor);
    const page = all.slice(start, start + PAGE);
    const tools = page.map((t) => {
      const title = t.name.startsWith("mcp__")
        ? t.name.replace(/^mcp__/, "").replace(/__/g, ": ")
        : t.name.replace(/_/g, " ");
      return {
        name: t.name, title,
        description: t.schema.function.description,
        inputSchema: t.schema.function.parameters,
        // Advertise a declared output schema when the tool provides one (Faz 14B).
        ...(t.schema.function.outputSchema ? { outputSchema: t.schema.function.outputSchema } : {}),
        annotations: {
          title,
          readOnlyHint: t.tier === "safe",
          destructiveHint: t.tier !== "safe",
          openWorldHint: t.tier === "host_upstream",
        },
      };
    });
    const nextCursor = start + PAGE < all.length ? encodeCursor(start + PAGE) : undefined;
    return { tools, nextCursor };
  });

  // --- tools/call (progress + structured-log notifications around the call) ---
  // `extra.signal` (Faz 17D) is the SDK-provided per-request AbortSignal: the SDK
  // wires the MCP `notifications/cancelled` for this request to abort it. Threaded
  // into the choke-point so an in-flight tool returns promptly as cancelled.
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args } = req.params;
    const progressToken = (req.params?._meta as any)?.progressToken;
    const onProgress = progressToken
      ? (progress: number, total?: number, message?: string) =>
          server.notification({ method: "notifications/progress", params: { progressToken, progress, total, message } }).catch(() => {})
      : undefined;
    const def = ToolRegistry.info(name);
    // Faz 18: server→client elicitation/sampling, wired ONLY when the connected
    // client advertises the matching capability (bidirectional stdio). Undefined
    // otherwise → tools fall back (e.g. write_file halt) — no HTTP regression.
    const caps = server.getClientCapabilities();
    const onElicit = caps?.elicitation
      ? async (message: string, requestedSchema: any) => {
          const e = await server.elicitInput({ message, requestedSchema });
          return { action: e.action, content: e.content };
        }
      : undefined;
    const onSample = caps?.sampling
      ? async (p: { messages: any[]; systemPrompt?: string; maxTokens?: number }) => {
          const m = await server.createMessage({ messages: p.messages, systemPrompt: p.systemPrompt, maxTokens: p.maxTokens ?? 1024 });
          return { text: (m.content as any)?.type === "text" ? String((m.content as any).text) : "" };
        }
      : undefined;
    // Surface host/privileged invocations at a higher severity (Faz 14A). Awaited
    // so the message is flushed on the response stream before the result.
    await emitLog(def && def.tier !== "safe" ? "notice" : "info", { msg: `tool.call ${name}`, tier: def?.tier, tenant: ctx.tenantId });
    onProgress?.(0, 1, `starting ${name}`);
    const r = await ToolRegistry.execute(name, args || {}, { ...ctx, progressToken, onProgress, abortSignal: extra?.signal, onElicit, onSample });
    onProgress?.(1, 1, `done ${name}`);
    await emitLog(r.ok ? "info" : "error", { msg: `tool.done ${name}`, ok: r.ok });
    const text = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
    // Structured content (Faz 14B): keep the text block (backwards-compatible) and
    // add structuredContent when the tool declares an output schema + object output.
    const structured = def?.schema.function.outputSchema && r.output && typeof r.output === "object"
      ? { structuredContent: r.output as Record<string, unknown> }
      : {};
    return { content: [{ type: "text" as const, text }], ...structured, isError: !r.ok };
  });

  // --- resources/list + resources/read (workspace files, tenant-scoped) ---
  server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
    let files: string[] = [];
    try {
      const tree = await ctx.deps.FilesystemManager.getTree(ctx.isLive, ctx.workspaceRoot);
      // getTree returns a FileItem[] tree (NOT a string) — flatten to file relative paths.
      // (Was String(tree.tree).split("\n") → "[object Object]" garbage resources.)
      files = flattenTreeFiles(tree.tree || []).slice(0, 200);
    } catch { /* best-effort */ }
    const start = decodeCursor(req.params?.cursor);
    const page = files.slice(start, start + PAGE);
    return {
      resources: page.map((f) => ({ uri: `file://${f}`, name: f, mimeType: "text/plain" })),
      nextCursor: start + PAGE < files.length ? encodeCursor(start + PAGE) : undefined,
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = String(req.params.uri || "");
    const rel = uri.replace(/^file:\/\//, "");
    // Binary-aware: known binary extensions return a base64 `blob` (MCP binary
    // resource), so images/archives/binaries download uncorrupted. Text falls back
    // to the utf-8 `text` field as before.
    const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
    const BIN: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", ico: "image/x-icon", pdf: "application/pdf", zip: "application/zip",
      gz: "application/gzip", tar: "application/x-tar", wasm: "application/wasm",
      mp3: "audio/mpeg", mp4: "video/mp4", woff: "font/woff", woff2: "font/woff2",
      bin: "application/octet-stream", exe: "application/octet-stream",
    };
    try {
      if (BIN[ext]) {
        const buf = ctx.deps.FilesystemManager.readFileBuffer(ctx.isLive, ctx.workspaceRoot, rel);
        return { contents: [{ uri, mimeType: BIN[ext], blob: buf.toString("base64") }] };
      }
      const text = ctx.deps.FilesystemManager.readFile(ctx.isLive, ctx.workspaceRoot, rel);
      return { contents: [{ uri, mimeType: "text/plain", text }] };
    } catch (e: any) {
      return { contents: [{ uri, mimeType: "text/plain", text: `Error reading resource: ${e?.message || e}` }] };
    }
  });

  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    const uri = String(req.params.uri || "");
    subscriptions.subscribe(uri);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscriptions.unsubscribe(String(req.params.uri || ""));
    return {};
  });

  // --- prompts/list + prompts/get (3-stage pipeline as MCP prompts, Faz 11A) ---
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = getPrompt(req.params.name);
    if (!p) throw new Error(`Unknown prompt: ${req.params.name}`);
    return {
      description: p.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: p.render((req.params.arguments as any) || {}) } }],
    };
  });

  // --- completion/complete (enum autocomplete for prompt args) ---
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const ref = req.params.ref as any;
    const arg = req.params.argument as any;
    const values = ref?.type === "ref/prompt" ? completeArg(ref.name, arg?.name, arg?.value) : [];
    return { completion: { values, total: values.length, hasMore: false } };
  });

  return server;
}

/** Express handler for any method on /mcp. */
export async function handleMcpRequest(req: Request, res: Response, ctxFactory: CtxFactory): Promise<void> {
  const server = buildServer(ctxFactory(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
