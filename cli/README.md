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
| `ollamas doctor` | health of gateway + ollama + bridge + ready + agent |
| `ollamas config [k] [v]` | show config, or set `gateway\|model\|provider\|apiKey\|profile` |

Run `ollamas <command> --help` for per-command flags. Common flags: `--json`,
`--timeout <ms>`, `-m/--model`, `-p/--provider`. Global: `--gateway <url>`.

## Config & env

Config file: `~/.ollamas/cli.json` (mode 0600). Env overrides file overrides defaults:

```
OLLAMAS_GATEWAY   gateway base url (default http://localhost:3000)
OLLAMAS_API_KEY   bearer key for SAAS-enforced gateways (chat/agent need this when 401)
OLLAMAS_MODEL     default model (default qwen3:8b)
OLLAMAS_PROVIDER  default provider (default ollama-local)
NO_COLOR          disable ANSI color
```

## Remote / iOS

The gateway is HTTP — reach it from a phone over LAN or tailscale, then either:

- **SSH/iSH:** run `bin/ollamas.sh <doctor|chat|agent> …` (pure curl, no Node).
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

## Tests

```bash
npx vitest run tests/cli-*.test.ts     # pure-fn + mock-fetch, no server boot
```
