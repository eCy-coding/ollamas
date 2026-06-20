// `ollamas mcp` — speak MCP to the gateway from the terminal. Every tool call
// crosses the gateway's single choke-point at /mcp (ToolRegistry.execute); this
// command never imports the registry. Subcommand shape + guard + tool-signature
// render are ported (zero-dep TS) from f/mcptools (MIT); the destructive-tool
// HIL gate from jonigl/mcp-client-for-ollama (MIT).
//   ollamas mcp info                       what the gateway exposes (no auth)
//   ollamas mcp tools [--sig]              list tools (guarded); --sig = signatures
//   ollamas mcp call <tool> [--params '{…}'] [--arg k=v …] [--yes]
//   ollamas mcp upstreams                  list registered upstream MCP servers
//   ollamas mcp add --name n --transport http --url … [--allow a,b]
//   ollamas mcp rm <id> [--yes]
import { parseArgs } from "node:util";
import { GatewayClient, type UpstreamInput } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, formatTable, c, type OutputCtx } from "../lib/output";
import { confirm } from "../lib/io";
import {
  filterByGuard,
  formatToolSignature,
  toolDanger,
  argsFromPairs,
  renderToolResult,
  formatProgress,
  renderResourceContents,
  renderPromptMessages,
  formatPromptSignature,
  promptArgsFromPairs,
  type McpTool,
} from "../lib/mcp";

const HELP = `ollamas mcp <action> — MCP client over the gateway choke-point

  info                               tiers/tools the gateway exposes (no auth)
  tools [--sig]                      list tools; --sig shows param signatures
  call <tool> [--params '{json}'] [--arg k=v …] [--yes] [--stream]
                                     invoke a tool (host/destructive tools prompt;
                                     --stream shows progress for long tools)
  resources                          list resources the gateway exposes (uri, name)
  read <uri>                         read a resource's contents
  prompts [--sig]                    list prompt templates; --sig shows arg signatures
  prompt <name> [--arg k=v …]        render a prompt's message chain
  upstreams                          list registered upstream MCP servers
  add --name <n> --transport http|stdio [--url <u>|--command <c> --args a,b] [--allow t1,t2]
  rm <id> [--yes]                    remove an upstream (prompts unless --yes)

auth: tools/call/upstreams need a tenant key — set OLLAMAS_API_KEY (not admin token).
guard: OLLAMAS_MCP_ALLOW / OLLAMAS_MCP_DENY (CSV globs) filter tools locally.
flags: --json (raw), --help`;

export async function runMcp(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      params: { type: "string" },
      arg: { type: "string", multiple: true },
      name: { type: "string" },
      transport: { type: "string" },
      url: { type: "string" },
      command: { type: "string" },
      args: { type: "string" },
      allow: { type: "string" },
      sig: { type: "boolean" },
      stream: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP + "\n");
    return values.help ? 0 : 2;
  }

  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey);
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  const [action, arg1] = positionals;
  const allow = csv(cfg.mcpGuardAllow);
  const deny = csv(cfg.mcpGuardDeny);

  try {
    switch (action) {
      case "info":
        return await showInfo(client, ctx);
      case "tools":
        return await showTools(client, allow, deny, !!values.sig, ctx);
      case "call":
        return await callTool(client, arg1, values, allow, deny, ctx);
      case "resources":
        return await showResources(client, ctx);
      case "read":
        return await readResource(client, arg1, ctx);
      case "prompts":
        return await showPrompts(client, !!values.sig, ctx);
      case "prompt":
        return await getPrompt(client, arg1, values, ctx);
      case "upstreams":
        return await showUpstreams(client, ctx);
      case "add":
        return await addUpstream(client, values, ctx);
      case "rm":
        return await removeUpstream(client, arg1, values, ctx);
    }
    process.stderr.write(`mcp: unknown action '${action}'\n` + HELP + "\n");
    return 2;
  } catch (e: any) {
    process.stderr.write(c("red", `mcp error: ${String(e?.message || e)}`, ctx.color) + "\n");
    return 1;
  }
}

async function showInfo(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const info = await client.mcpInfo();
  if (ctx.json) return json(info);
  process.stdout.write(c("bold", "mcp gateway", ctx.color) + "\n");
  process.stdout.write(`  tiers      ${c("cyan", (info.exposeTiers || []).join(", "), ctx.color)}\n`);
  process.stdout.write(`  tools      ${info.exposedTools?.length ?? 0}\n`);
  process.stdout.write(`  upstreams  ${info.upstreams?.length ?? 0}\n`);
  return 0;
}

async function showTools(client: GatewayClient, allow: string[], deny: string[], sig: boolean, ctx: OutputCtx): Promise<number> {
  const all = await client.mcpListTools();
  const tools = filterByGuard(all, allow, deny);
  if (ctx.json) return json(tools);
  if (sig) {
    for (const t of tools) {
      process.stdout.write(formatToolSignature(t, ctx) + "\n");
      if (t.description) process.stdout.write(c("dim", `    ${t.description}`, ctx.color) + "\n");
    }
    process.stdout.write(c("dim", `${tools.length} tool(s)${guardNote(all.length, tools.length)}`, ctx.color) + "\n");
    return 0;
  }
  process.stdout.write(
    formatTable(
      ["tool", "danger", "description"],
      tools.map((t) => [t.name, toolDanger(t) ? "⚠" : "", trim(t.description)]),
      ctx,
    ) + "\n",
  );
  process.stdout.write(c("dim", `${tools.length} tool(s)${guardNote(all.length, tools.length)}`, ctx.color) + "\n");
  return 0;
}

async function callTool(client: GatewayClient, name: string | undefined, v: any, allow: string[], deny: string[], ctx: OutputCtx): Promise<number> {
  if (!name) {
    process.stderr.write("mcp call: missing <tool>\n");
    return 2;
  }
  // Fetch tool metadata once: validates the name, types --arg values, and tells
  // us whether the HIL gate must fire (destructive/open-world tool).
  const all = await client.mcpListTools();
  const visible = filterByGuard(all, allow, deny);
  const tool = visible.find((t) => t.name === name);
  if (!tool) {
    const blocked = !visible.find((t) => t.name === name) && all.find((t) => t.name === name);
    process.stderr.write(blocked ? `mcp call: '${name}' blocked by local guard\n` : `mcp call: unknown tool '${name}'\n`);
    return 2;
  }

  const args = buildArgs(v, tool);
  // HIL gate (J5): a destructive/open-world tool prompts before it runs, unless
  // --yes or --json (non-interactive). Default-ON for safety (ollmcp pattern).
  if (toolDanger(tool) && !v.yes && !ctx.json) {
    const ok = await confirm(c("yellow", `run destructive tool '${name}' with ${JSON.stringify(args)}? [y/N] `, ctx.color));
    if (!ok) {
      process.stdout.write(c("dim", "aborted", ctx.color) + "\n");
      return 0;
    }
  }

  // --stream consumes notifications/progress as they arrive (terminal-only;
  // SSE can't be rendered under --json, which wants one final document).
  const streaming = v.stream && !ctx.json;
  const result = streaming
    ? await client.mcpCallToolStream(name, args, (p) => process.stderr.write(formatProgress(p, ctx) + "\n"))
    : await client.mcpCallTool(name, args);
  if (ctx.json) return json(result);
  const text = renderToolResult(result);
  if (result.isError) {
    process.stderr.write(c("red", text || "(tool reported an error)", ctx.color) + "\n");
    return 1;
  }
  process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
  return 0;
}

async function showResources(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const resources = await client.mcpListResources();
  if (ctx.json) return json(resources);
  process.stdout.write(
    formatTable(
      ["uri", "name", "mime", "description"],
      resources.map((r) => [r.uri, r.name ?? r.title ?? "", r.mimeType ?? "", trim(r.description)]),
      ctx,
    ) + "\n",
  );
  process.stdout.write(c("dim", `${resources.length} resource(s)`, ctx.color) + "\n");
  return 0;
}

async function readResource(client: GatewayClient, uri: string | undefined, ctx: OutputCtx): Promise<number> {
  if (!uri) {
    process.stderr.write("mcp read: missing <uri>\n");
    return 2;
  }
  const result = await client.mcpReadResource(uri);
  if (ctx.json) return json(result);
  const text = renderResourceContents(result);
  process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
  return 0;
}

async function showPrompts(client: GatewayClient, sig: boolean, ctx: OutputCtx): Promise<number> {
  const prompts = await client.mcpListPrompts();
  if (ctx.json) return json(prompts);
  if (sig) {
    for (const p of prompts) {
      process.stdout.write(formatPromptSignature(p, ctx) + "\n");
      if (p.description) process.stdout.write(c("dim", `    ${p.description}`, ctx.color) + "\n");
    }
  } else {
    process.stdout.write(
      formatTable(
        ["prompt", "args", "description"],
        prompts.map((p) => [p.name, (p.arguments || []).map((a) => a.name).join(","), trim(p.description)]),
        ctx,
      ) + "\n",
    );
  }
  process.stdout.write(c("dim", `${prompts.length} prompt(s)`, ctx.color) + "\n");
  return 0;
}

async function getPrompt(client: GatewayClient, name: string | undefined, v: any, ctx: OutputCtx): Promise<number> {
  if (!name) {
    process.stderr.write("mcp prompt: missing <name>\n");
    return 2;
  }
  const args = promptArgsFromPairs(Array.isArray(v.arg) ? v.arg : v.arg ? [v.arg] : []);
  const result = await client.mcpGetPrompt(name, args);
  if (ctx.json) return json(result);
  process.stdout.write(renderPromptMessages(result) + "\n");
  return 0;
}

// Merge --params '{json}' (base) with repeated --arg k=v (override), typed via schema.
function buildArgs(v: any, tool: McpTool): Record<string, any> {
  let base: Record<string, any> = {};
  if (v.params) {
    try {
      base = JSON.parse(v.params);
    } catch {
      throw new Error("--params must be valid JSON");
    }
  }
  const pairs = argsFromPairs(Array.isArray(v.arg) ? v.arg : v.arg ? [v.arg] : [], tool);
  return { ...base, ...pairs };
}

async function showUpstreams(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const ups = await client.listUpstreams();
  if (ctx.json) return json(ups);
  process.stdout.write(
    formatTable(
      ["id", "name", "transport", "target", "tools"],
      ups.map((u) => [u.id, u.name, u.transport ?? "", u.url || u.command || "", (u.allowed_tools || []).join(",")]),
      ctx,
    ) + "\n",
  );
  return 0;
}

async function addUpstream(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  if (!v.name || !v.transport) {
    process.stderr.write("mcp add: --name and --transport (http|stdio) required\n");
    return 2;
  }
  const body: UpstreamInput = {
    name: v.name,
    transport: v.transport,
    url: v.url,
    command: v.command,
    args: v.args ? String(v.args).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
    allowedTools: v.allow ? String(v.allow).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
  };
  const r = await client.addUpstream(body);
  if (ctx.json) return json(r);
  process.stdout.write(c("green", `upstream added: ${r.id}`, ctx.color) + `  (${body.name}, ${body.transport})\n`);
  return 0;
}

async function removeUpstream(client: GatewayClient, id: string | undefined, v: any, ctx: OutputCtx): Promise<number> {
  if (!id) {
    process.stderr.write("mcp rm: missing <id>\n");
    return 2;
  }
  if (!v.yes && !ctx.json) {
    const ok = await confirm(c("yellow", `remove upstream ${id}? [y/N] `, ctx.color));
    if (!ok) {
      process.stdout.write(c("dim", "aborted", ctx.color) + "\n");
      return 0;
    }
  }
  const r = await client.removeUpstream(id);
  if (ctx.json) return json(r);
  process.stdout.write(c("green", `removed ${r.deleted}`, ctx.color) + c("dim", `  (${r.toolsRemoved} tool(s) unregistered)`, ctx.color) + "\n");
  return 0;
}

function csv(s?: string): string[] {
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}
function guardNote(total: number, shown: number): string {
  return total > shown ? ` (${total - shown} hidden by guard)` : "";
}
function trim(s?: string): string {
  if (!s) return "";
  const line = s.split("\n")[0];
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}
function json(data: any): number {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  return 0;
}
