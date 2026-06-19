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
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { ToolRegistry, type ToolCtx, type ToolTier } from "../tool-registry";
import { PROMPTS, getPrompt, completeArg } from "./prompts";

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
  tools: { listChanged: false }, resources: {}, prompts: {}, completions: {}, logging: {},
} as const;

// RFC 5424 severities, MCP logging order (low → high). A message is sent when its
// severity is at or above the connection's current level.
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];
const rank = (l: string) => { const i = LOG_LEVELS.indexOf(l as LogLevel); return i < 0 ? 1 : i; };

function buildServer(ctx: ToolCtx): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { ...MCP_CAPABILITIES } }
  );

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
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const progressToken = (req.params?._meta as any)?.progressToken;
    const onProgress = progressToken
      ? (progress: number, total?: number, message?: string) =>
          server.notification({ method: "notifications/progress", params: { progressToken, progress, total, message } }).catch(() => {})
      : undefined;
    const def = ToolRegistry.info(name);
    // Surface host/privileged invocations at a higher severity (Faz 14A). Awaited
    // so the message is flushed on the response stream before the result.
    await emitLog(def && def.tier !== "safe" ? "notice" : "info", { msg: `tool.call ${name}`, tier: def?.tier, tenant: ctx.tenantId });
    onProgress?.(0, 1, `starting ${name}`);
    const r = await ToolRegistry.execute(name, args || {}, { ...ctx, progressToken, onProgress });
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
      // getTree returns a printed tree string; extract file-ish lines conservatively.
      files = String(tree.tree || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.endsWith("/")).slice(0, 200);
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
    let text = "";
    try { text = ctx.deps.FilesystemManager.readFile(ctx.isLive, ctx.workspaceRoot, rel); }
    catch (e: any) { text = `Error reading resource: ${e?.message || e}`; }
    return { contents: [{ uri, mimeType: "text/plain", text }] };
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
