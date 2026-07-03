# FLEET_SHIP.md — batch gated-ship ledger (auto-generated)

> Auto: `tsx orchestration/bin/fleet-apply.ts --apply-all` · 2026-07-03T03:11:46Z. Applies every apply-ready **safe-auto**
> proposal (additive, gate-covered), each gated independently (tsc + vitest): kept on GREEN, reverted on RED.
> Left UNCOMMITTED — the conductor reviews `git diff` and commits. `review`/`blocked` tiers are NOT
> auto-shipped (semantic risk / gate can't verify) — apply them one-by-one with `--apply <stream>.<slot>`.

## Result: 2 shipped · 0 reverted · 2 skipped

| Target | Model | Tier | Files | Outcome |
|--------|-------|------|-------|---------|
| errors-resilience.terminal | `qwen3-coder:480b-cloud` | safe-auto | server/agent-events.ts | applied + gate GREEN |
| mjs-migration.terminal | `gpt-oss:120b-cloud` | safe-auto | scripts/agent-dispatch.mjs | applied + gate GREEN |
| concurrency-safety.terminal | `gpt-oss:120b-cloud` | review | server/host-bridge.ts | modifies existing logic — conductor must judge semantics |
| shell-harden.terminal | `gpt-oss:20b-cloud` | blocked | start.sh | gate can't verify (shell/unknown target) |

## Shipped (uncommitted — review `git diff` then commit)
- `errors-resilience.terminal` → server/agent-events.ts
- `mjs-migration.terminal` → scripts/agent-dispatch.mjs

## Skipped (conductor must judge — `--apply <stream>.<slot>`)
- `concurrency-safety.terminal` (review) → modifies existing logic — conductor must judge semantics
- `shell-harden.terminal` (blocked) → gate can't verify (shell/unknown target)
