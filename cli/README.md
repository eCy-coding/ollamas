# ollamas CLI

Unified terminal client for the **LLM Mission Control** gateway. One command,
three surfaces: the Node CLI here, a zero-runtime POSIX bridge (`bin/ollamas.sh`)
for SSH/iSH, and (v6) an Apple Shortcuts pack for iOS.

> **Design law:** the CLI is a thin HTTP/MCP client. It never imports
> `server/tool-registry` — every tool side effect crosses the gateway's single
> choke-point (`AGENTS.md §4`). See `CLI_AGENTS.md` for the full contract.

## Install

```bash
npm run build:cli      # esbuild → dist/cli/index.cjs
npm link               # exposes `ollamas` globally (bin field in package.json)
# dev (no build): npm run cli -- <command>     e.g. npm run cli -- doctor
```

## Commands

| Command | What |
|---------|------|
| `ollamas chat [prompt]` | one-shot, piped (`echo x \| ollamas chat`), or TTY REPL; streams tokens |
| `ollamas agent [task]` | drive the ReAct agent loop; streams thought→step→done; prompts before writes (`--yolo` to auto-apply) |
| `ollamas agent sessions` | list persisted agent sessions |
| `ollamas agent rm <id>` | delete a session |
| `ollamas saas <action>` | admin: `plans\|tenants\|keys\|audit\|usage\|billing`, `tenant new`, `key new\|revoke` |
| `ollamas mcp <action>` | MCP client over `/mcp`: `info\|tools\|call\|upstreams\|add\|rm` |
| `ollamas bench` | benchmark models (tok/s, TTFB) across mac/remote targets; `--apply` picks the fastest |
| `ollamas doctor` | health of gateway + ollama + bridge + ready + agent + saas + mcp |
| `ollamas config [k] [v]` | show config, or set `gateway\|model\|provider\|apiKey\|saasAdminToken\|profile` |

Run `ollamas <command> --help` for per-command flags. Common flags: `--json`,
`--timeout <ms>`, `-m/--model`, `-p/--provider`. Global: `--gateway <url>`.

## Config & env

Config file: `~/.ollamas/cli.json` (mode 0600). Env overrides file overrides defaults:

```
OLLAMAS_GATEWAY    gateway base url (default http://localhost:3000)
OLLAMAS_API_KEY    bearer key for SAAS-enforced gateways (chat/agent need this when 401)
OLLAMAS_SAAS_ADMIN admin token (X-Admin-Token) for saas/billing commands
OLLAMAS_MODEL      default model (default qwen3:8b)
OLLAMAS_PROVIDER   default provider (default ollama-local)
OLLAMAS_MCP_ALLOW  CSV glob whitelist for `mcp tools|call` (local guard)
OLLAMAS_MCP_DENY   CSV glob blacklist for `mcp tools|call` (local guard)
NO_COLOR           disable ANSI color
```

## SaaS / admin

`ollamas saas …` drives the gateway's multi-tenant layer (server `adminGuard`,
`X-Admin-Token` = the gateway's `SAAS_ADMIN_TOKEN`). Set the token via
`OLLAMAS_SAAS_ADMIN` or `ollamas config saasAdminToken <token>`. A 401/403 prints
a hint. `saas key new` shows the plaintext key **once** — the gateway keeps only a
hash. `saas key revoke` prompts unless `--yes`/`--json`.

> **Security:** the admin token grants tenant/key/billing control. Send it to a
> remote gateway only over TLS or a private tunnel (tailscale/LAN) — never plain
> HTTP across an untrusted network.

## MCP client

`ollamas mcp` speaks JSON-RPC to the gateway's `/mcp` endpoint — every tool call
still crosses the single choke-point (`ToolRegistry.execute`); the CLI never runs
tools itself. The transport is **stateless** (no `initialize` handshake, no session
id) and replies SSE-framed.

```bash
ollamas mcp info                       # tiers/tools the gateway exposes (no auth)
ollamas mcp tools [--sig]              # list tools (⚠ = destructive); --sig = signatures
ollamas mcp call read_file --arg path=cli/index.ts
ollamas mcp call run_command --params '{"command":"git status"}'
ollamas mcp upstreams                  # registered upstream MCP servers
ollamas mcp add --name X --transport http --url http://host:port/mcp --allow tool_a,tool_b
ollamas mcp rm <id>                    # prompts unless --yes
```

- **Auth:** `tools/call`, `upstreams`, `add`, `rm` need a **tenant** key
  (`OLLAMAS_API_KEY`) — *not* the admin token. `info` is public.
- **HIL gate:** a tool with `destructiveHint`/`openWorldHint` (e.g. `macos_terminal`,
  `git_commit`) prompts before it runs, unless `--yes` or `--json` (ported from
  jonigl/mcp-client-for-ollama).
- **Local guard:** `OLLAMAS_MCP_ALLOW`/`OLLAMAS_MCP_DENY` (CSV globs) filter which
  tools `mcp tools`/`call` will show/permit — a client-side allow/deny on top of the
  gateway's per-tenant tier visibility (ported from f/mcptools `guard`).

## Remote / iOS

The gateway is HTTP — reach it from a phone over LAN or tailscale, then either:

- **SSH/iSH:** run `bin/ollamas.sh <doctor|chat|agent|mcp> …` (pure curl, no Node).
- **Shortcuts (v6):** generated `.shortcut` files POST to `/api/generate` and `/api/agent/chat`.

Set `OLLAMAS_GATEWAY` to the reachable URL and `OLLAMAS_API_KEY` when the gateway
enforces auth (`SAAS_ENFORCE=1`).

## Agent write approval

By default `ollamas agent` prompts before each `write_file` (a `paused` event from
the gateway). Approve → the CLI POSTs `/api/agent/approve-write` and resumes the
loop. `--yolo` sets `autoApply` so the gateway applies writes without pausing.

> Note: on resume the CLI re-primes the agent with the assistant history plus an
> "approved and wrote X — continue" turn; full tool-result history lives in the
> server session. Multi-write tasks loop until done (cap 12 rounds).

## Benchmark

`ollamas bench` times each model through `/api/generate` (real ollama tok/s from
`eval_count/eval_duration`) and derives TTFB from the first stream chunk. It runs
a discarded **warmup** call first (cold-start loads the model into Metal VRAM;
`keep_alive=30m` keeps it warm) so the timed runs are fair. Median for latencies,
mean for throughput. Writes `~/.llm-mission-control/cli-bench.json` tagged with the
**host platform** (`platform/arch/release`) — a container reading is not a
Mac-native reading. `--target both --remote-gateway <url>` also benchmarks the
remote endpoint an iOS Shortcut would hit. `--apply` saves the fastest correct
model to config.

## Tests

```bash
npx vitest run tests/cli-*.test.ts     # pure-fn + mock-fetch, no server boot
```
