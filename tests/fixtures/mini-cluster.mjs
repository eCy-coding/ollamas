// Second stdio MCP upstream fixture (v1.10) — proves multi-upstream cluster
// fan-out + allowedTools filtering alongside mini-mcp.mjs. Exposes two tools:
// `node_info` (allowed in tests) and `node_secret` (filtered out by allowlist).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "mini-cluster", version: "0.0.1" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "node_info", description: "returns cluster node id", inputSchema: { type: "object", properties: {} } },
    { name: "node_secret", description: "should be filtered by allowlist", inputSchema: { type: "object", properties: {} } },
  ],
}));
s.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: req.params.name === "node_info" ? "node-1" : "LEAK" }],
}));
await s.connect(new StdioServerTransport());
