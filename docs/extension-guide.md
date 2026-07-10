# Extension Guide

ollamas is built to be extended. The mechanisms are mature — this page is the single
index that points you at the right extension point and where to start for each one.

Everything a tool does crosses one choke-point (`ToolRegistry.execute`,
`server/tool-registry.ts`); everything the CLI does crosses the HTTP surface
(`/api/*` + `/mcp`). Pick your extension point below and follow its "start here" link.

## The nine extension points

| # | You want to… | Extension point | Start here |
|---|--------------|-----------------|------------|
| 1 | **Add a built-in tool** the agent can call (read files, run host work, write host files) | First-party `ToolDef` in the `TOOLS` map (`server/tool-registry.ts:195`) | [adding-a-tool.md](./adding-a-tool.md) |
| 2 | **Consume an upstream MCP server** — merge someone else's MCP tools into your gateway | MCP client / consume side, tools registered via `ToolRegistry.register` at tier `host_upstream` | [INTEGRATIONS.md](../INTEGRATIONS.md), [MCP_LANE.md](../MCP_LANE.md) |
| 3 | **Expose your tools over MCP** to third-party MCP clients | `/mcp` Streamable HTTP endpoint + `/.well-known/mcp.json` discovery (`server/mcp/server.ts`, `server/openapi.ts`) | [api-quickstart.md](./api-quickstart.md), [MCP_LANE.md](../MCP_LANE.md) |
| 4 | **Add a Claude Code skill** (domain expertise the assistant loads on demand) | `.claude/skills/<name>/SKILL.md` (frozen by `tests/skills-wiring.test.ts`) | [../.claude/HOWTO-ADD-SKILL.md](../.claude/HOWTO-ADD-SKILL.md) |
| 5 | **Add an `ollamas` CLI subcommand** | `cli/commands/*.ts` (zero-dep TS) wired into `cli/index.ts` | [../cli/ADDING-A-COMMAND.md](../cli/ADDING-A-COMMAND.md) |
| 6 | **Add an external `ollamas <name>` subcommand** without touching the source — checksum-gated plugin | `ollamas plugin install` (`cli/commands/plugin.ts`, trust-on-first-use sha256 gate) | Run `ollamas plugin --help`; source: [../cli/commands/plugin.ts](../cli/commands/plugin.ts) |
| 7 | **Call the gateway from your own program** over HTTP / JSON-RPC | REST `/api/*` + MCP `/mcp` with Bearer `olm_<key>` | [api-quickstart.md](./api-quickstart.md) |
| 8 | **Integrate a Claude Code slash command / hook** into this harness | `.claude/commands/*.md` (frontmatter + `allowed-tools`); CLI permissioning via `.claude/HOWTO-ADD-CLI.md` | [../.claude/HOWTO-ADD-CLI.md](../.claude/HOWTO-ADD-CLI.md) |
| 9 | **Bring/pick a model or a custom OpenAI-compatible endpoint** | Provider catalog + `custom-openai` seam; model selection | [model-guide.md](./model-guide.md), [custom-model.md](./custom-model.md) (GGUF → Modelfile import) |

## How the points relate

```
                 ┌─────────────────────────────────────────────┐
   third-party   │  /mcp  (JSON-RPC, Bearer olm_)  ──► [3] expose│
   MCP clients ──┤  /api/* (REST)                  ──► [7] HTTP API│
                 └───────────────┬─────────────────────────────┘
                                 │
                    ToolRegistry.execute  ◄── the ONE choke-point
                                 │
        ┌────────────────────────┼───────────────────────────┐
        │                        │                            │
   [1] built-in ToolDef   [2] consumed upstream        (tier gates all)
   (TOOLS map)            (register, host_upstream)

   Client side:  ollamas CLI ──► [5] subcommands · [6] plugins
   Assistant:    Claude Code ──► [4] skills · [8] slash commands/hooks
   Models:       [9] provider catalog + custom-openai
```

- **Server-side tool authors** work at points 1–3 — everything funnels through
  `ToolRegistry`, and the **tier** you choose (`safe`/`host`/`privileged`/`host_upstream`)
  is the security contract for all three. Read [adding-a-tool.md](./adding-a-tool.md) first.
- **CLI authors** work at points 5–6 — the CLI is zero-dep and never imports
  `server/tool-registry`; it only speaks HTTP `/api/*` + `/mcp`.
- **Assistant/harness authors** work at points 4 & 8 under `.claude/`.
- **Model/endpoint** wiring is point 9.

## Ground rules for every extension

- **One choke-point.** Server-side tools dispatch only through `ToolRegistry.execute`.
  The CLI reaches the server only through `/api/*` + `/mcp` — never a direct
  `server/tool-registry` import.
- **Tier honestly.** A new tool's tier decides who may run it and what MCP clients
  are told about it. See the tier matrix in [adding-a-tool.md](./adding-a-tool.md).
- **Zero-dep CLI.** CLI subcommands use only Node built-ins.
- **Verify before ship.** `npm run lint` (`tsc --noEmit`) then `npm run test`
  (`vitest run`) green before committing.

## See also

- Getting started: [../QUICKSTART.md](../QUICKSTART.md) · full docs index: [../README.md](../README.md)
- Deploying your extended build (local / Docker / compose / Helm / k8s): [deploy-guide.md](./deploy-guide.md)
- Test suite, gates & skip map (what your extension must keep green): [TESTING.md](./TESTING.md)
- Release rollback runbook: [RELEASE_ROLLBACK.md](./RELEASE_ROLLBACK.md)
- Something broke while extending: [troubleshooting.md](./troubleshooting.md)
