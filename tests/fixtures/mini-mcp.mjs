// Tiny stdio MCP server used as a CONSUME-side upstream fixture in tests.
// Exposes a single `ping` tool that returns "pong".
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "mini", version: "0.0.1" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ping", description: "returns pong", inputSchema: { type: "object", properties: {} } }],
}));
s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "pong" }] }));
await s.connect(new StdioServerTransport());
