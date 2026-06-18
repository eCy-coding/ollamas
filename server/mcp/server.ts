// MCP server (EXPOSE side, AGENTS.md Faz 1). Publishes the workspace tools from
// the single ToolRegistry choke-point over Streamable HTTP at /mcp, so external
// MCP clients (Claude Code, the MCP Inspector, ...) can listTools / callTool.
//
// Stateless transport: a fresh Server+transport per request (no session state),
// which is the simplest robust pattern for a multi-tenant gateway — per-tenant
// context is supplied by the caller via ctxFactory.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { ToolRegistry, type ToolCtx, type ToolTier } from "../tool-registry";

/** Builds a per-request ToolCtx (tenant, deps, allowlist, metering). */
export type CtxFactory = (req: Request) => ToolCtx;

function buildServer(ctx: ToolCtx): Server {
  const server = new Server(
    { name: "ollamas-gateway", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // Only advertise tools this caller is allowed to run (AGENTS.md §5).
  const allowed: ToolTier[] | undefined = ctx.allowedTiers;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ToolRegistry.list(allowed).map((t) => {
      // Human title + behavioral hints (MCP Tools spec). Hints derive from the
      // security tier: only `safe` tools are non-destructive; everything else
      // (host/privileged/upstream) can mutate the host or run untrusted code.
      const title = t.name.startsWith("mcp__")
        ? t.name.replace(/^mcp__/, "").replace(/__/g, ": ")
        : t.name.replace(/_/g, " ");
      return {
        name: t.name,
        title,
        description: t.schema.function.description,
        inputSchema: t.schema.function.parameters,
        annotations: {
          title,
          readOnlyHint: t.tier === "safe",
          destructiveHint: t.tier !== "safe",
          openWorldHint: t.tier === "host_upstream",
        },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const r = await ToolRegistry.execute(name, args || {}, ctx);
    const text = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
    return { content: [{ type: "text" as const, text }], isError: !r.ok };
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
