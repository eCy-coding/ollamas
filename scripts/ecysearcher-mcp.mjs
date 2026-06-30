#!/usr/bin/env node
// scripts/ecysearcher-mcp.mjs — a stdio MCP server that exposes eCySearcher's threat-intel REST API
// as tools, so the ollamas ReAct agent can call them as mcp__ecysearcher__*. Registered as an
// upstream in tools.json (mcpServers[]); server/mcp/client.ts auto-consumes it (zero server code).
//
// Each tool proxies a `fetch` to the eCySearcher Flask API (ECYSEARCHER_URL, default :5000) and
// returns the JSON. eCySearcher must be running (`ollamas ecysearcher up`); a down upstream yields
// an honest error in the tool result, never a crash.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// ── pure request-builders (unit-tested) ──────────────────────────────────────────────────────
// All tools hit the ONE fixed unified endpoint /api/search/search (blueprint /api/search + route
// /search) with a type filter — the other CRUD routes share a latent bug + aren't needed.
export function ecyBase(env = process.env) {
  if (env.ECYSEARCHER_URL) return env.ECYSEARCHER_URL.replace(/\/$/, "");
  const port = env.ECYSEARCHER_API_PORT || "5055";
  return `http://localhost:${port}`;
}
function unifiedUrl(base, { q, type, limit }) {
  const u = new URL(`${base}/api/search/search`);
  u.searchParams.set("q", String(q ?? ""));
  if (type) u.searchParams.set("type", String(type));
  u.searchParams.set("limit", String(limit ?? 50));
  return u.toString();
}
export function searchUrl(base, args = {}) {
  return unifiedUrl(base, { q: args.q, type: args.type || "all", limit: args.limit });
}
export function domainUrl(base, args = {}) {
  return unifiedUrl(base, { q: args.name, type: "domains", limit: args.limit });
}
export function ipUrl(base, args = {}) {
  return unifiedUrl(base, { q: args.ip, type: "ips", limit: args.limit });
}
export function threatsUrl(base, args = {}) {
  return unifiedUrl(base, { q: args.q ?? "", type: "threats", limit: args.limit });
}

export const TOOLS = [
  { name: "ecysearcher_search", description: "Search eCySearcher threat intelligence (domains, IPs, indicators) for a query.",
    inputSchema: { type: "object", properties: { q: { type: "string" }, type: { type: "string", enum: ["all", "threats", "domains", "ips"] }, limit: { type: "number" } }, required: ["q"] }, url: searchUrl },
  { name: "ecysearcher_domain", description: "List known threats for a domain.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, url: domainUrl },
  { name: "ecysearcher_ip", description: "Geolocation + reputation for an IP address.",
    inputSchema: { type: "object", properties: { ip: { type: "string" } }, required: ["ip"] }, url: ipUrl },
  { name: "ecysearcher_threats", description: "List the most recent threat indicators.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } }, url: threatsUrl },
];

/** Resolve the upstream URL for a tool call. Pure. */
export function urlForTool(name, args, env = process.env) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`unknown tool: ${name}`);
  return t.url(ecyBase(env), args || {});
}

// ── thin IO ──────────────────────────────────────────────────────────────────────────────────
async function callTool(name, args) {
  const url = urlForTool(name, args);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    const text = await res.text();
    return { content: [{ type: "text", text }], isError: !res.ok };
  } catch (e) {
    return { content: [{ type: "text", text: `eCySearcher unreachable (${url}): ${String(e?.message || e)}. Start it with 'ollamas ecysearcher up'.` }], isError: true };
  }
}

async function main() {
  const server = new Server({ name: "ecysearcher", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments || {}));
  await server.connect(new StdioServerTransport());
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("ecysearcher-mcp.mjs");
if (invokedDirectly) main().catch((e) => { console.error(`[ecysearcher-mcp] ${e?.message || e}`); process.exit(1); });
