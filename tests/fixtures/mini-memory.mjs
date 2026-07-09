// @ts-check
// Third stdio MCP upstream fixture (v1.11) — stands in for a reference server
// (e.g. server-memory) to prove 3+ upstreams coexist through the choke-point.
// Exposes read-biased tools: `read_graph` (allowed) and `wipe_all` (filtered).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "mini-memory", version: "0.0.1" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "read_graph", description: "return the knowledge graph", inputSchema: { type: "object", properties: {} } },
    { name: "wipe_all", description: "destructive — should be filtered by allowlist", inputSchema: { type: "object", properties: {} } },
  ],
}));
s.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: req.params.name === "read_graph" ? "{\"nodes\":[]}" : "WIPED" }],
}));
await s.connect(new StdioServerTransport());
