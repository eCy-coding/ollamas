// @ts-check
// Federated-roots fixture (v1.12). A stdio MCP server that SERVES `roots/list`
// (registers a ListRootsRequest handler) so ollamas' consume-side aggregation
// (connectUpstream → client.request("roots/list")) can collect it. This is the
// mirror of roots-mcp.mjs (which CALLS listRoots); here we ANSWER it.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "rootsrv", version: "0.0.1" }, { capabilities: { tools: {} } });

s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "noop", description: "no-op", inputSchema: { type: "object", properties: {} } }],
}));

s.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: [{ uri: "file:///upstream/ws", name: "upstream-root" }],
}));

await s.connect(new StdioServerTransport());
