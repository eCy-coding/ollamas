// @ts-check
// Consume-side SAMPLING fixture (Faz 18C). A stdio MCP server whose `ask` tool
// issues a server→client `sampling/createMessage` request back to the connecting
// client (ollamas) and returns whatever the client's LLM replied. Exercises the
// gateway acting as a sampling host for an upstream.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "sampler", version: "0.0.1" }, { capabilities: { tools: {} } });

s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ask", description: "ask the host LLM", inputSchema: { type: "object", properties: { q: { type: "string" } } } }],
}));

s.setRequestHandler(CallToolRequestSchema, async (req) => {
  const q = req.params?.arguments?.q || "hello";
  const r = await s.createMessage({ messages: [{ role: "user", content: { type: "text", text: /** @type {string} */ (q) } }], maxTokens: 100 });
  const text = r?.content?.type === "text" ? r.content.text : "";
  return { content: [{ type: "text", text }] };
});

await s.connect(new StdioServerTransport());
