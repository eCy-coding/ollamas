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
} from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { ToolRegistry, type ToolCtx, type ToolTier } from "../tool-registry";
import { PROMPTS, getPrompt, completeArg } from "./prompts";

/** Builds a per-request ToolCtx (tenant, deps, allowlist, metering). */
export type CtxFactory = (req: Request) => ToolCtx;

const PAGE = 50;
const encodeCursor = (n: number) => Buffer.from(String(n)).toString("base64");
const decodeCursor = (c?: string) => (c ? parseInt(Buffer.from(c, "base64").toString(), 10) || 0 : 0);

function buildServer(ctx: ToolCtx): Server {
  const server = new Server(
    { name: "ollamas-gateway", version: "1.2.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} } }
  );

  const allowed: ToolTier[] | undefined = ctx.allowedTiers;

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

  // --- tools/call (with progress notifications around the call) ---
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const progressToken = (req.params?._meta as any)?.progressToken;
    const onProgress = progressToken
      ? (progress: number, total?: number, message?: string) =>
          server.notification({ method: "notifications/progress", params: { progressToken, progress, total, message } }).catch(() => {})
      : undefined;
    onProgress?.(0, 1, `starting ${name}`);
    const r = await ToolRegistry.execute(name, args || {}, { ...ctx, progressToken, onProgress });
    onProgress?.(1, 1, `done ${name}`);
    const text = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
    return { content: [{ type: "text" as const, text }], isError: !r.ok };
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
