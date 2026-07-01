---
description: Run the model-council — fan out the 18-model fleet (capability-matched, ≤2/model) to analyze the project; oracle-verify claims; multi-model debate for confidence.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/council.ts:*), Bash(npx tsx orchestration/bin/council.ts:*)
argument-hint: "[--all] [--debate] [--lane <name>]"
---
Run `./node_modules/.bin/tsx orchestration/bin/council.ts $ARGUMENTS`.

No flags = light (refresh COUNCIL_ROSTER.json + report). `--all` runs all 7 lanes; `--debate` fans 3 diverse models per lane for best-of-N agreement. Findings are oracle-audited (deterministic ground-truth; prose ≠ evidence). Report the roster coverage, per-lane findings count, and oracle verdicts. See `docs/E2E_ANALYSIS.md`, `docs/CODE_PLAN.md`, `.claude/BRAIN.md`.
