---
description: Dispatch a task to the Gemini CLI as a read-only PROPOSE worker and print its answer — makes Gemini a first-class orchestra vendor alongside ollama local/cloud. Read-only (`--approval-mode plan`, no repo mutation); transient 503 "high demand" is retried with backoff + `gemini-2.5-flash` fallback.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/gemini-run.ts:*), Bash(npx tsx orchestration/bin/gemini-run.ts:*)
argument-hint: "\"<task>\" [--model gemini-2.5-flash] [--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/gemini-run.ts $ARGUMENTS`.

Gemini CLI (0.49.0, account-authed) as a fleet-compatible model. Invoked headless: `gemini -p <task> -m <model> --approval-mode plan -o json --skip-trust` (with `GEMINI_CLI_TRUST_WORKSPACE=true`). `plan` mode is READ-ONLY — Gemini proposes, the conductor applies. In the fleet, any `gemini-*` model tag routes here via `providerFor` → `gemini-cli` (see `bin/lib/gemini.ts` + `fleet-agent.ts`); `gemini-2.5-flash` is in the `errors-resilience` roster.

- `"<task>"` — dispatch and print the response.
- `--propose <stream>` — GROUNDED fleet proposal: inlines the stream's focus-file content so the model copies exact lines into a SEARCH/REPLACE block (deterministic → apply-ready), writes it to `~/.llm-mission-control/fleet/work/<stream>.<vendor>/PROPOSAL.md`, then triage/apply with `fleet-apply` like any worker. **Pool fail-over (vO60/61):** if gemini's day is spent, it routes the SAME grounded proposal to the best free-tier API vendor (`pickVendor` → groq/cerebras/zai via `scripts/agent-dispatch.mjs`) so the vendor production loop never stalls. Hardened (vO61): iterates vendors in budget order with transient-retry (backoff), and only writes an answer that `isActionableProposal` (a real SEARCH/REPLACE block, matching the downstream gate) — never an empty/prose body. Proven live: gemini-2.5-flash → safe-auto shipped (vO57); gemini 20/20 → groq 3× deterministic + cerebras, both fleet-apply "SR resolves cleanly" (vO60/61).
- `--quota` — show today's gemini free-tier budget `{date, used, limit, remaining}` (no API call).
- `--budget` — show the WHOLE free-tier vendor pool's remaining budget today (gemini + groq/cerebras/zai). No API call. This is the pool the fleet fails over across (vO59).
- `--model <tag>` — default `gemini-2.5-flash` (the `pro` tier is often demand-throttled; flash is reliable).
- `--json` — machine output.

Free-tier has a **daily quota** (≈20 requests, override `GEMINI_DAILY_LIMIT`). A **pre-flight quota gate** (`bin/lib/gemini-quota.ts`, persisted at `~/.llm-mission-control/gemini-quota.json`) skips the call entirely when the day's budget is spent — fail-fast in ~0.1s instead of a doomed ~50s backoff. The first real 429 latches the day exhausted. Transient 503 is still retried with backoff.

**vO59 — vendor pool (never stall):** the daily-budget math is now generalized into `bin/lib/vendor-budget.ts` (a per-vendor pool at `~/.llm-mission-control/vendor-budget.json`; `gemini-quota.ts` re-exports it). When gemini's day is spent, `fleet-agent.ts` fails over to the next free-tier vendor with budget (`pickVendor` → most-remaining among the stream's `provider::model` tails, groq/cerebras/zai) so the grounded-proposal production loop never stalls on one vendor. Each API-worker dispatch is pre-flight budget-gated + usage-recorded (429 latches the vendor for the day). Proven live: gemini 20/20 → pool picks groq → real `/api/agent/chat` dispatch → budget recorded.

See `.claude/BRAIN.md` (Gemini vendor-overload row).
