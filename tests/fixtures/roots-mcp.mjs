// Consume-side ROOTS fixture (Faz 20A). A stdio MCP server whose `whereami` tool
// issues a server→client `roots/list` request back to the connecting client
// (ollamas) and returns the first root URI it reports. Exercises ollamas
// advertising its workspace root as a sandbox signal to an upstream.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "rooter", version: "0.0.1" }, { capabilities: { tools: {} } });

s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "whereami", description: "report the host's first workspace root", inputSchema: { type: "object", properties: {} } }],
}));

s.setRequestHandler(CallToolRequestSchema, async () => {
  const r = await s.listRoots();
  const uri = Array.isArray(r?.roots) && r.roots[0] ? r.roots[0].uri : "(no roots)";
  return { content: [{ type: "text", text: uri }] };
});

await s.connect(new StdioServerTransport());
