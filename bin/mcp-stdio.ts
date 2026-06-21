#!/usr/bin/env node
// v1.8: stdio EXPOSE entry point. Lets ollamas run as a local MCP server over
// stdio — i.e. `npx ollamas-mcp` — so Claude Desktop / Claude Code / Cursor can
// consume the workspace tools directly, no HTTP server or SaaS layer needed.
//
// It reuses the SAME ToolRegistry choke-point and the SAME buildServer() that the
// HTTP /mcp path uses — there is no second dispatch path (AGENTS.md §4). stdio is
// inherently single local user → single-tenant: no metering (onUsage), no tenantId,
// no Stripe. Multi-tenant stays HTTP-only.
//
// CONTRACT: in stdio mode stdout is RESERVED for the MCP JSON-RPC stream. Nothing
// here may write to stdout — diagnostics go to stderr only.
import "dotenv/config"; // load .env into process.env before any provider/key read (stdio MCP boot)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../server/mcp/server";
import { FilesystemManager } from "../server/files";
import { TerminalManager } from "../server/terminal";
import { runOnHostTerminal, execOnHost, writeHostFile, HOST_TOOLS_DIR, shArg } from "../server/host-bridge";
import { db } from "../server/db";
import type { ToolCtx, ToolDeps, ToolTier } from "../server/tool-registry";

// Local stdio mode is a single user who explicitly launched `ollamas-mcp` against
// their own workspace → grant on-disk read (and write when auto-apply is on). The
// persisted db may carry these off from a prior HTTP session; the launch intent
// overrides that here. Opt out with MCP_STDIO_NO_FS=1.
const autoApply = process.env.MCP_AUTO_APPLY !== "0";
if (process.env.MCP_STDIO_NO_FS !== "1") {
  db.data.permissions.fileRead = true;
  // Writes are permitted in local mode; MCP_AUTO_APPLY only governs whether a write
  // applies directly (true) or is gated by elicitation/halt approval (false).
  db.data.permissions.fileWrite = true;
}

const VALID_TIERS: ToolTier[] = ["safe", "host", "privileged", "host_upstream"];
// Default to safe-tier only: the pure filesystem/terminal tools work with no host
// bridge running. Widen with MCP_STDIO_TIERS=safe,host,privileged when the bridge
// is up. host_upstream stays opt-in (untrusted upstream tools).
const allowedTiers = (process.env.MCP_STDIO_TIERS || "safe")
  .split(",").map((s) => s.trim()).filter((t): t is ToolTier => (VALID_TIERS as string[]).includes(t));

const deps: ToolDeps = {
  FilesystemManager, TerminalManager, runOnHostTerminal, writeHostFile, execOnHost, HOST_TOOLS_DIR, shArg,
  // No persistent security log in local stdio mode; keep stdout clean for the protocol.
  db: { logSecurity: () => {} },
};

const ctx: ToolCtx = {
  isLive: true, // real on-disk workspace
  workspaceRoot: process.env.OLLAMAS_WORKSPACE || process.cwd(),
  autoApply, // local user → apply writes by default
  deps,
  allowedTiers,
};

async function main() {
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[ollamas-mcp] stdio server ready — tiers=[${allowedTiers.join(",")}] workspace=${ctx.workspaceRoot}\n`);
}

main().catch((e) => {
  process.stderr.write(`[ollamas-mcp] fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
