---
description: Conductor apply-readiness triage for the fleet's gated proposals — extracts each PROPOSAL.md diff, dry-runs `git apply --check` (read-only), and reports which are apply-ready vs illustrative → orchestration/FLEET_APPLY.md. `--apply <stream>.<slot>` applies ONE apply-ready proposal, gates it (tsc + tests), and keeps it only if green (else reverts). The main tree is never left broken; illustrative/weak diffs are never blindly applied.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-apply.ts:*), Bash(npx tsx orchestration/bin/fleet-apply.ts:*)
argument-hint: "[--apply <stream>.<slot>] [--json]"
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-apply.ts $ARGUMENTS`.

The fleet PRODUCES gated proposals (Change/Diff/Test) but nothing APPLIES them — this closes the produce→gate→APPLY loop safely. It reads every `~/.llm-mission-control/fleet/work/<stream>.<slot>/PROPOSAL.md`, extracts the first fenced diff, and dry-runs `git apply --check`. A proposal is **apply-ready** only when its diff is shaped (real `@@ -a,b +c,d @@` line numbers or a `new file` marker) AND applies cleanly to the current tree — most worker diffs are illustrative (no line numbers) and are surfaced, not applied.

- (no args) — triage → `orchestration/FLEET_APPLY.md` (apply-ready vs illustrative + reason + target files).
- `--apply <stream>.<slot>` — apply ONE apply-ready proposal to the tree, run the full gate (tsc + vitest), keep on green, `git apply -R` revert on red. The conductor reviews `git diff` and commits if correct.

Never blindly applies weak-model output; the conductor (Claude) reviews + gates. See `.claude/BRAIN.md`.
