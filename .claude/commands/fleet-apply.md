---
description: Conductor apply-readiness triage for the fleet's gated proposals — extracts each PROPOSAL.md diff / SEARCH-REPLACE block, classifies a risk-tier (safe-auto | review | blocked), and reports which are apply-ready → orchestration/FLEET_APPLY.md. `--apply <stream>.<slot>` applies ONE, gates it (tsc + tests), keeps on green (else reverts). `--apply-all` batch-ships every apply-ready **safe-auto** proposal, each independently gated, left UNCOMMITTED for review → FLEET_SHIP.md. The main tree is never left broken; review/blocked tiers are never auto-applied.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-apply.ts:*), Bash(npx tsx orchestration/bin/fleet-apply.ts:*)
argument-hint: "[--apply <stream>.<slot>] [--apply-all] [--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-apply.ts $ARGUMENTS`.

The fleet PRODUCES gated proposals (Change/Diff/Test) but nothing APPLIES them — this closes the produce→gate→APPLY loop safely. It reads every `~/.llm-mission-control/fleet/work/<stream>.<slot>/PROPOSAL.md`, extracts the first fenced diff, and dry-runs `git apply --check`. A proposal is **apply-ready** only when its diff is shaped (real `@@ -a,b +c,d @@` line numbers or a `new file` marker) AND applies cleanly to the current tree — most worker diffs are illustrative (no line numbers) and are surfaced, not applied.

- (no args) — triage → `orchestration/FLEET_APPLY.md` (apply-ready + **risk-tier** + reason + target files).
- `--apply <stream>.<slot>` — apply ONE apply-ready proposal, run the full gate (tsc + vitest), keep on green, revert on red. The conductor reviews `git diff` and commits if correct.
- `--apply-all` — batch gated-ship: apply every apply-ready **safe-auto** (additive, gate-covered `.ts/.tsx/.mjs`) proposal, each independently gated (revert restores the pre-apply snapshot so earlier batch edits are never clobbered). `review` (modifies existing logic) and `blocked` (shell/unknown — gate can't verify) tiers are surfaced, NOT auto-applied. Green edits are left UNCOMMITTED → `orchestration/FLEET_SHIP.md`; the conductor reviews the aggregate `git diff` and commits.

Never blindly applies weak-model output; the conductor (Claude) reviews + gates. **Import-safety guard (vO55): a proposal that ADDS an unresolvable runtime import (a `.d.ts` type-only file, or a missing relative module) is statically detected and forced to `blocked` — collect() downgrades the tier and `--apply`/`--apply-all` refuse it before running, because the tsc+vitest gate is blind to this class (`node x.mjs` would crash at runtime). Semantic risks that ARE gate-invisible but not import-shaped still need the conductor's `git diff` review.** See `.claude/BRAIN.md`.
