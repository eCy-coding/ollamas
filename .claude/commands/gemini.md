---
description: Dispatch a task to the Gemini CLI as a read-only PROPOSE worker and print its answer — makes Gemini a first-class orchestra vendor alongside ollama local/cloud. Read-only (`--approval-mode plan`, no repo mutation); transient 503 "high demand" is retried with backoff + `gemini-2.5-flash` fallback.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/gemini-run.ts:*), Bash(npx tsx orchestration/bin/gemini-run.ts:*)
argument-hint: "\"<task>\" [--model gemini-2.5-flash] [--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/gemini-run.ts $ARGUMENTS`.

Gemini CLI (0.49.0, account-authed) as a fleet-compatible model. Invoked headless: `gemini -p <task> -m <model> --approval-mode plan -o json --skip-trust` (with `GEMINI_CLI_TRUST_WORKSPACE=true`). `plan` mode is READ-ONLY — Gemini proposes, the conductor applies. In the fleet, any `gemini-*` model tag routes here via `providerFor` → `gemini-cli` (see `bin/lib/gemini.ts` + `fleet-agent.ts`); `gemini-2.5-flash` is in the `errors-resilience` roster.

- `"<task>"` — dispatch and print the response.
- `--propose <stream>` — GROUNDED fleet proposal: inlines the stream's focus-file content so Gemini copies exact lines into a SEARCH/REPLACE block (deterministic → apply-ready), writes it to `~/.llm-mission-control/fleet/work/<stream>.gemini/PROPOSAL.md`, then triage/apply with `fleet-apply` like any worker. Proven live: gemini-2.5-flash → safe-auto, import-safe, gated-shipped change (vO57).
- `--model <tag>` — default `gemini-2.5-flash` (the `pro` tier is often demand-throttled; flash is reliable).
- `--json` — machine output `{ok, model, text, err?}`.

Free-tier has a **daily quota** (≈20 requests); on 429 the dispatcher fails fast (retry won't help until reset) — distinct from a transient 503 (retried with backoff).

See `.claude/BRAIN.md` (Gemini vendor-overload row).
