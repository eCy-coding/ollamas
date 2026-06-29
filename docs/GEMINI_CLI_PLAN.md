# Gemini CLI Integration — Build Plan

> Step-by-step plan to add Google's **Gemini CLI** as a concurrent system in ollamas.
> Research backing this: [`GEMINI_CLI_RESEARCH.md`](./GEMINI_CLI_RESEARCH.md).

## Goal
A **"Gemini Bridge"**: a new `ollamas gemini` subcommand + an optional persistent Gemini-agent
backend, so ollamas gains Gemini 3 (OAuth free-tier / API-key / Vertex), Google Search grounding,
and Gemini CLI's tools/MCP/extensions — AND lets Gemini CLI call ollamas's own local tools.
**Bidirectional, choke-point-safe (N-012), zero-dep on the CLI side.**

## Architecture
```
                ┌─────────────────────────── ollamas ───────────────────────────┐
  ollamas CLI ──┤  cli/commands/gemini.ts  (NEW, zero-dep)                        │
  (user)        │     ├─ spawn `gemini --output-format json|stream-json` ────────┼──▶ Gemini CLI ──▶ Google
                │     │     (Gemini 3 / Search grounding / OAuth|key|Vertex)      │   (@google/...)   (all systems)
                │     └─ `setup-mcp`: gemini mcp add http <gw>/mcp  ◀─────────────┼──┐
                │  server/gemini-a2a (NEW, optional concurrent backend) ─JSON-RPC─┼─▶│ gemini-cli-a2a-server :41242
                │     └─ registered as provider `gemini-cli`                      │  │ (persistent SSE agent)
                │  /mcp  (existing) ◀─────────────────────────────────────────────┼──┘  Gemini CLI calls ollamas tools
                └─────────────────────────────────────────────────────────────────┘
```
- **Outbound:** ollamas → Gemini CLI (subprocess or A2A) for Gemini reasoning + Google systems.
- **Inbound:** Gemini CLI → ollamas `/mcp` for ollamas host tools (write_host_file, macos_terminal, grep…).
- **Choke-point:** CLI shells out to the `gemini` binary (no `server/tool-registry` import); A2A client lives server-side.

## Phases (each ends in a conventional commit)

### Phase 1 — Subprocess JSON bridge (CLI, zero-dep) — MVP
- **`cli/lib/gemini.ts`** (pure + thin-IO):
  - `buildGeminiArgs(opts)` — pure: `{prompt, model?, json?, stream?, yolo?, approvalMode?, includeDirs?}` → argv (`["--output-format","json", ...]`).
  - `parseGeminiJson(stdout)` — pure, tolerant → `{response, stats, error}`.
  - `mapExitCode(code)` — `0|1|42|53` → typed `{ok, kind}` (`success|apiError|inputError|turnLimit`).
  - `detectGemini()` — `which gemini` / `gemini --version` (thin-IO).
  - Spawn via `node:child_process.spawn` (stream) / `execFile` (json).
- **`cli/commands/gemini.ts`** — `ollamas gemini "<prompt>" [--json] [--stream] [--yolo] [--model m] [--vertex] [--include <dir>]`:
  - preflight `detectGemini()` → skip-with-guidance if absent (`npm i -g @google/gemini-cli`).
  - auth from env: OAuth (default) / `GEMINI_API_KEY` / Vertex (`--vertex` sets `GOOGLE_GENAI_USE_VERTEXAI`).
  - TTY-aware: pretty `stream-json` when TTY; raw `json` with `--json`.
  - map exit codes → human messages.
- **Wire** `case "gemini": return runGemini(rest)` into `cli/index.ts` + help text.
- **Gate:** zero-dep, `grep tool-registry cli/`=empty, tsc 0, unit tests for the pure fns.
- **Commit:** `feat(cli): ollamas gemini — Google Gemini CLI bridge (headless json/stream)`.

### Phase 2 — Reverse MCP (Gemini CLI gains ollamas tools)
- **`ollamas gemini setup-mcp [--scope user|project] [--url <gw/mcp>]`** — runs `gemini mcp add --transport http ollamas <url>` (default `http://127.0.0.1:<gatewayPort>/mcp`); read back `~/.gemini/settings.json` to verify; warn + auto-fix the known `type:http` bug.
- **`ollamas gemini status`** — is the `gemini` binary present? which auth? is ollamas MCP registered + reachable?
- **`ollamas doctor`** — add a Gemini section.
- **Commit:** `feat(cli): ollamas gemini setup-mcp — register ollamas tools into Gemini CLI`.

### Phase 3 — Concurrent A2A backend (the persistent "runs-concurrently" system)
- **Sidecar manager** (`scripts/gemini-a2a.mjs`): start/stop `gemini-cli-a2a-server` on `CODER_AGENT_PORT=41242`; health = `GET /.well-known/agent.json`. Pin a version.
- **`server/gemini-a2a.ts`** (server-side, deps allowed): thin A2A client — `POST /` `message/stream`, consume SSE `TaskStatusUpdateEvent` (working/input-required/completed/failed) → normalize to the ollamas agent event shape (thought/step/message/done). Register as ProviderRouter backend **`gemini-cli`**; failover → existing provider chain.
- **Fleet:** add `gemini-cli` to `assignWorker` candidates (codegen / Google-grounded tasks) → a first-class concurrent fleet worker (reuses the dispatch ledger).
- **Commit:** `feat(server): concurrent Gemini-CLI A2A backend + provider + fleet worker`.

### Phase 4 — Tests, docs, e2e
- **Unit:** `buildGeminiArgs` / `parseGeminiJson` / `mapExitCode` (table-driven incl. exit 42/53 + malformed json); A2A event normalizer.
- **E2E (skip-with-loud-warn if `gemini` absent — honest, no fabrication):** `ollamas gemini "say hi" --json` → exit 0 + `.response`; `setup-mcp` writes settings; (if a2a-server installed) a `message/stream` round-trip.
- **Docs:** this file + the research doc; update CLI help.
- **Commit:** `test(cli): gemini bridge unit + e2e (skip-with-warn)`.

## Constraints / gotchas
- **Zero-dep CLI:** Phase 1-2 = `node:*` + the external `gemini` binary (runtime tool, not an npm dep). A2A deps server-side only.
- **N-012:** never import `server/tool-registry` from CLI; bridge = subprocess + HTTP.
- **`--yolo` safety:** default OFF; explicit flag only; never auto-yolo on untrusted input.
- **Headless OAuth:** can't browser-auth over SSH → copy `~/.gemini/oauth_creds.json`, or prefer `GEMINI_API_KEY` / Vertex for CI.
- **Evidence law:** "works" = run the command + show real stdout + exit code; A2A = a real SSE round-trip.
- **Version pinning:** the `-p`→positional deprecation and the `type:http` settings bug are version-sensitive.

## Sub-agent usage matrix (100% E2E surfaces)

`gemini-cli` is a first-class provider — EVERY ollamas sub-agent can select/route it. One backend
(`server/gemini-cli.ts`) serves them all (the efficient seam: no per-surface allowlist).

| Sub-agent surface | How to use gemini-cli | Status |
|---|---|---|
| CLI ReAct agent | `ollamas agent --provider gemini-cli "<task>"` | ✅ (no allowlist) |
| CLI chat | `ollamas chat -p gemini-cli "<prompt>"` | ✅ |
| Sub-agent dispatcher | `node scripts/agent-dispatch.mjs "<task>" --provider gemini-cli` | ✅ |
| ReAct Specialist UI | provider dropdown → "Gemini CLI (Local)" | ✅ (S2) |
| Multi-agent pipeline UI | per-stage provider → "Gemini CLI" (architect/coder/reviewer) | ✅ (S2) |
| Dispatch fleet | a `google-grounded` task → `gemini-cli` worker, executed on the local gateway | ✅ (P2 + S1) |
| Server endpoints | `/api/agent/chat`, `/api/pipeline`, `/api/generate` accept `provider:"gemini-cli"` | ✅ (no allowlist) |
| Models | `GET /api/models/gemini-cli` → models or install hint | ✅ |

**Env-gate (operator step, P5):** the LIVE call needs the `gemini` binary + Google auth
(`npm i -g @google/gemini-cli` + OAuth / `GEMINI_API_KEY` / Vertex). Absent → honest skip-with-warn;
all wiring is unit/ui-tested.

## Verification (E2E, no mocks)
1. Gate: `tsc --noEmit` 0 · `vitest run` (new pure tests) green · `grep -rn tool-registry cli/` empty · `git diff package.json` shows no new CLI dep.
2. Bridge: `ollamas gemini "respond with the single word PONG" --json | jq -r .response` → `PONG`, exit 0. Force a bad arg → exit 42.
3. Reverse MCP: `ollamas gemini setup-mcp` → `gemini mcp list` shows `ollamas`; in `gemini`, `/mcp` lists ollamas tools; a tool call hits the gateway.
4. Concurrent A2A (if installed): boot a2a-server :41242 → ollamas routes a task to backend `gemini-cli` → live SSE → `completed`, both processes side by side.
5. Honest env-gating: every step skips-with-warn (not fail) when `gemini` / a2a-server / Google auth is absent.
