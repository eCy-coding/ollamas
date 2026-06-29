# Gemini CLI Integration — Research Findings

> Real-time web research (multi-source, 2026-06) for adding Google's **Gemini CLI** as a
> concurrent system in ollamas. Companion: [`GEMINI_CLI_PLAN.md`](./GEMINI_CLI_PLAN.md).
> Sources at the bottom. Every claim cross-checked against ≥2 sources (official docs + DeepWiki of the repo).

## 1. What Gemini CLI is
`@google/gemini-cli` (repo `google-gemini/gemini-cli`, Apache-2.0): Google's official open-source
terminal AI agent (React/Ink UI). Install `npm i -g @google/gemini-cli` → run `gemini`.

**Monorepo packages** (relevant for embedding):
| Package | Role |
|---|---|
| `@google/gemini-cli` | CLI entry + terminal UI |
| `@google/gemini-cli-core` | API client, tool registry, policy engine |
| `@google/gemini-cli-sdk` | programmatic SDK (`GeminiCliAgent`/`GeminiCliSession`) |
| `@google/gemini-cli-a2a-server` | experimental Agent-to-Agent (A2A) server |

## 2. Headless / non-interactive (the bridge contract)
- **Trigger headless:** `gemini -p "<prompt>"` or positional `gemini "<prompt>"` (`-p` deprecating → positional), OR any non-TTY (piped) run.
- **`--output-format`:** `text` (default) | `json` | `stream-json`.
  - **json** → `{ "response": string, "stats": object, "error"?: object }` (single object).
  - **stream-json** → JSONL events: `init` (sessionId, model) · `message` (assistant/user chunk) · `tool_use` (tool + args) · `tool_result` · `error` (non-fatal) · `result` (final + aggregated per-model token stats).
- **stdin context:** `cat err.log | gemini -p "explain why this failed"` → entire stdin read + appended to prompt.
- **Exit codes:** `0` success · `1` general/API error · `42` input error (bad prompt/args) · `53` turn-limit exceeded.
- **Approval modes:** `--approval-mode default|auto_edit|yolo|plan`; `--yolo` / `-y` auto-approves ALL tool calls (sandbox auto-on). Don't combine `--yolo` with `--approval-mode` → use `--approval-mode=yolo`.
  - ⚠️ **Security:** `--yolo` executes shell/writes with no confirmation. ONLY in trusted, fully-controlled input.
- **Other scripting flags:** `-m/--model` (e.g. gemini-3-pro / -flash) · `--session-summary <file>` (metrics JSON) · `--include-directories` · `-o` (output-format alias).
- **Examples:**
  ```bash
  gemini -p "What is Kubernetes?" --output-format json | jq -r '.response'
  git diff --cached | gemini -p "write a concise commit message" --output-format json | jq -r '.response'
  gemini --approval-mode=yolo --output-format json -p "review this PR"
  ```

## 3. Authentication — "all Google systems"
1. **OAuth "Sign in with Google"** — no key; **free tier 60 req/min, 1000 req/day**, Gemini 3, 1M-token context. Org/paid Code Assist → set `GOOGLE_CLOUD_PROJECT`.
   - ⚠️ Browser OAuth does NOT work over SSH/headless → auth on a machine with a browser, then copy `~/.gemini/oauth_creds.json` (+ `~/.gemini/mcp-oauth-tokens.json`) to the target.
2. **`GEMINI_API_KEY`** (AI Studio) — specific-model / paid; free tier ~1000 req/day.
3. **Vertex AI** — `GOOGLE_API_KEY` + `GOOGLE_GENAI_USE_VERTEXAI=true` (+ `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` for non-interactive). Enterprise/prod.

What "all systems" brings: Gemini 3 models, **Google Search grounding** (built-in tool), Code Assist, the CLI's built-in tools (file/shell/web), configured MCP servers, and extensions.

## 4. MCP — Gemini CLI is a CLIENT, not a server
- `gemini mcp add [-s user|project] [-t stdio|sse|http] [-e ENV] [-H header] [--trust] <name> <cmdOrUrl> [args…]`.
- Config persists to `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project) under `mcpServers`. `/mcp` in the REPL shows status.
- HTTP example: `gemini mcp add --transport http ollamas http://127.0.0.1:8090/mcp`.
- **Gemini CLI does NOT expose itself as an MCP server.** Agent↔agent uses **A2A**, not MCP. Extensions: `gemini extensions install <github-url>`.
- Known bug (v0.22.2): `gemini mcp add -t http …` may write a `"type":"http"` key that fails to load → manually remove/fix in `settings.json`.

## 5. A2A — the concurrent-agent server (the "runs concurrently" system)
- `@google/gemini-cli-a2a-server` (experimental): `npm run start:a2a-server` → `node dist/src/http/server.js`, port `CODER_AGENT_PORT` (default **41242**).
- Protocol: **JSON-RPC over HTTP + SSE.** Client `POST /` a `message/stream` request → server returns `contextId`/`taskId` + an SSE stream of `TaskStatusUpdateEvent` (`working` | `input-required` | `completed` | `failed`, with text/artifacts). Optional `PushNotificationConfig` for async callback. Agent card at `/.well-known/agent.json`.
- Gemini CLI can also be an A2A **client** of remote subagents — defined as `.gemini/agents/*.md` (YAML frontmatter + `auth` block: API key / HTTP / Google ADC).
- **MCP vs A2A:** MCP connects agents → tools; **A2A connects agents → agents.** They complement.
- Status: experimental + an active RFC (Discussion #7822) to standardize a "development-tool" A2A extension.

## 6. SDK — in-process embedding (server-side option)
`@google/gemini-cli-sdk`:
```ts
import { GeminiCliAgent } from '@google/gemini-cli-sdk';
const agent = new GeminiCliAgent({ cwd: '/path/to/dir' /*, instructions, tools, model */ });
const session = agent.session();              // or agent.resumeSession(id)
for await (const chunk of session.sendStream('what does this project do?')) {
  console.log(chunk);                          // ServerGeminiStreamEvent — full agentic loop
}
```
ACP (`--experimental-acp`, `AcpSessionManager`) is for IDE drivers (Zed/JetBrains); not implemented in the SDK; not needed here.

## 7. ollamas integration surface (repo, file:line)
- **CLI:** `cli/index.ts` (`route()` :100, dispatch switch :272-348); subcommands `cli/commands/*`; **zero-dep** (`node:child_process` spawnSync :23, `parseArgs`, `readline`); plugins spawn with sha256 verify (:341).
- **Choke-point N-012:** CLI must NOT import `server/tool-registry`; tool exec only via gateway `/mcp` + `/api/*`. `grep -rn tool-registry cli/` = empty.
- **Gemini already server-side:** `server/providers.ts` (`@google/genai` → `generativelanguage.googleapis.com`; key vault `db.data.keys["gemini"]` + env `GEMINI_API_KEY[_1..9]`).
- **MCP expose:** `server/mcp/server.ts:51` publishes ToolRegistry over `/mcp`. **Upstream consume:** `server/mcp/{client,supervisor}.ts` (`tools.json` `mcpServers[]`, namespaced `mcp__<server>__*`).
- **Subprocess patterns to reuse:** server `execFile` (`server/revenue.ts:42`, `server/commander.ts`); CLI `spawnSync` (`cli/index.ts:341`). Secrets `cli/lib/config.ts` (AES-256-GCM `~/.ollamas/cli.json`).
- **Fleet/dispatch:** `cli/lib/dispatch-ledger.ts` (`assignWorker`), `cli/lib/remote-agent.ts` — a Gemini-CLI A2A backend can become a fleet worker.

## 8. Decision matrix
| Mode | What | Concurrency | Deps | Risk | Use |
|---|---|---|---|---|---|
| **Subprocess JSON bridge** | spawn `gemini … --output-format json` | one-shot/call | **zero** | low | **MVP (CLI)** |
| **Reverse MCP** | `gemini mcp add http …/mcp` | n/a (config) | zero | low | **bidirectional** |
| **A2A sidecar** | run a2a-server :41242, JSON-RPC/SSE | **persistent, concurrent** | server-side | med | **concurrent system** |
| SDK embed | `@google/gemini-cli-sdk` in-process | concurrent | server-side | med | alt to A2A |
| ACP | `--experimental-acp` | editor-driven | — | — | not needed |

**Recommendation:** ship Subprocess bridge + Reverse MCP first (zero-dep, immediate, bidirectional). Add the A2A sidecar as the true concurrent backend wired into the fleet.

## Sources
- https://github.com/google-gemini/gemini-cli · https://geminicli.com/docs/cli/headless/ · https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
- https://developers.googleblog.com/gemini-cli-fastmcp-simplifying-mcp-server-development/ · https://gofastmcp.com/integrations/gemini-cli · https://mcp.directory/clients/gemini-cli
- https://geminicli.com/docs/core/remote-agents/ · https://github.com/google-gemini/gemini-cli/discussions/7822
- DeepWiki `google-gemini/gemini-cli` (a2a-server `start:a2a-server` / `CODER_AGENT_PORT` 41242 / `message/stream` SSE; SDK `GeminiCliAgent`/`GeminiCliSession.sendStream`; ACP `--experimental-acp`)
