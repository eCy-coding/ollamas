// MCP HTTP server discovery (Faz 15A). Serves a /.well-known/mcp.json document so
// clients can learn this gateway's capabilities, transport, auth requirement, and
// primitive summary BEFORE opening an MCP connection. Follows the community
// .well-known/mcp.json shape (SEP-1649 / modelcontextprotocol discussion #1147).
//
// Tenant-agnostic: reports the unauthenticated single-user expose surface
// (MCP_EXPOSE_TIERS); authenticated tenants get their plan's tools at /mcp.
//
// Refs: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649

import { ToolRegistry, type ToolTier } from "../tool-registry";
import { PROMPTS } from "./prompts";
import {
  MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_PROTOCOL_VERSION, MCP_CAPABILITIES,
} from "./server";
import { PROTECTED_RESOURCE_PATH } from "./oauth-metadata";
import { REGISTRATION_PATH } from "./oauth-metadata";

export const MCP_DISCOVERY_PATH = "/.well-known/mcp.json";

const exposeTiers = (): ToolTier[] =>
  (process.env.MCP_EXPOSE_TIERS || "safe,host,privileged")
    .split(",").map((s) => s.trim()).filter(Boolean) as ToolTier[];

/** Discovery body. `baseUrl` is this server's externally-reachable origin. */
export function mcpDiscovery(baseUrl: string): Record<string, unknown> {
  const base = baseUrl.replace(/\/$/, "");
  return {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: { type: "streamable-http", endpoint: `${base}/mcp` },
    capabilities: { ...MCP_CAPABILITIES },
    auth: {
      required: process.env.SAAS_ENFORCE === "1",
      resourceMetadata: `${base}${PROTECTED_RESOURCE_PATH}`,
      registrationEndpoint: `${base}${REGISTRATION_PATH}`,
    },
    primitives: {
      tools: ToolRegistry.list(exposeTiers()).length,
      prompts: PROMPTS.length,
      resources: "workspace-files",
    },
  };
}
