// MCP client (CONSUME side, AGENTS.md Faz 1). Connects to upstream MCP servers,
// lists their tools, and merges each into the single ToolRegistry choke-point
// under a namespaced name `mcp__<server>__<tool>`. After connecting, the ReAct
// agent and the /mcp expose layer can call upstream tools transparently — they
// flow back out through ToolRegistry.execute like any built-in.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolRegistry } from "../tool-registry";

export interface UpstreamConfig {
  name: string;
  transport: "stdio" | "http";
  /** stdio: executable + args. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http: server URL. */
  url?: string;
}

export interface UpstreamResult {
  name: string;
  ok: boolean;
  tools: number;
  error?: string;
}

const clients = new Map<string, Client>();

/** Connect one upstream MCP server and register its tools. Never throws. */
export async function connectUpstream(cfg: UpstreamConfig): Promise<UpstreamResult> {
  try {
    const client = new Client({ name: "ollamas-gateway", version: "0.1.0" }, { capabilities: {} });

    const transport =
      cfg.transport === "stdio"
        ? new StdioClientTransport({ command: cfg.command!, args: cfg.args || [], env: cfg.env })
        : new StreamableHTTPClientTransport(new URL(cfg.url!));

    await client.connect(transport);
    const { tools } = await client.listTools();

    for (const t of tools) {
      const toolName = `mcp__${cfg.name}__${t.name}`;
      ToolRegistry.register(toolName, {
        // Upstream tools run outside our sandbox → treat as host tier (allowlist-gated).
        tier: "host",
        schema: {
          type: "function",
          function: {
            name: toolName,
            description: t.description || `${cfg.name}: ${t.name}`,
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
        },
        invoke: async (args: any) => {
          const r: any = await client.callTool({ name: t.name, arguments: args || {} });
          // Flatten MCP content blocks to text for the ReAct loop.
          if (Array.isArray(r?.content)) {
            return r.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
          }
          return r;
        },
      });
    }

    clients.set(cfg.name, client);
    return { name: cfg.name, ok: true, tools: tools.length };
  } catch (err: any) {
    return { name: cfg.name, ok: false, tools: 0, error: err?.message || String(err) };
  }
}

/** Connect all configured upstreams; best-effort, returns per-server status. */
export async function connectAllUpstreams(configs: UpstreamConfig[]): Promise<UpstreamResult[]> {
  return Promise.all(configs.map(connectUpstream));
}

export function listUpstreams(): string[] {
  return [...clients.keys()];
}
