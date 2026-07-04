# FLEET_SHIP.md — batch gated-ship ledger (auto-generated)

> Auto: `tsx orchestration/bin/fleet-apply.ts --apply-all` · 2026-07-04T08:56:41Z. Applies every apply-ready **safe-auto**
> proposal (additive, gate-covered), each gated independently (tsc + vitest): kept on GREEN, reverted on RED.
> Left UNCOMMITTED — the conductor reviews `git diff` and commits. `review`/`blocked` tiers are NOT
> auto-shipped (semantic risk / gate can't verify) — apply them one-by-one with `--apply <stream>.<slot>`.

## Result: 1 shipped · 3 reverted · 4 skipped

| Target | Model | Tier | Files | Outcome |
|--------|-------|------|-------|---------|
| errors-resilience.terminal | `qwen3-coder:480b-cloud` | safe-auto | server/agent-events.ts | applied + gate GREEN |
| errors-resilience.gemini | `gemini-2.5-flash` | safe-auto | server/agent-events.ts | gate RED → reverted (snapshot restore) |
| errors-resilience.groq | `llama-3.3-70b-versatile` | safe-auto | server/agent-events.ts | gate RED → reverted (snapshot restore) |
| mjs-migration.terminal | `gpt-oss:120b-cloud` | safe-auto | scripts/agent-dispatch.mjs | gate RED → reverted (snapshot restore) |
| concurrency-safety.cerebras | `gpt-oss-120b` | review | server/host-bridge.ts | modifies existing logic — conductor must judge semantics |
| concurrency-safety.terminal | `gpt-oss:120b-cloud` | review | server/host-bridge.ts | modifies existing logic — conductor must judge semantics |
| shell-harden.terminal | `gpt-oss:20b-cloud` | blocked | start.sh | gate can't verify (shell/unknown target) |
| typescript-core.terminal | `qwen3-coder:480b-cloud` | review | server/analyzer.ts | modifies existing logic — conductor must judge semantics |

## Shipped (uncommitted — review `git diff` then commit)
- `errors-resilience.terminal` → server/agent-events.ts

## Skipped (conductor must judge — `--apply <stream>.<slot>`)
- `concurrency-safety.cerebras` (review) → modifies existing logic — conductor must judge semantics
- `concurrency-safety.terminal` (review) → modifies existing logic — conductor must judge semantics
- `shell-harden.terminal` (blocked) → gate can't verify (shell/unknown target)
- `typescript-core.terminal` (review) → modifies existing logic — conductor must judge semantics
