---
description: Precompute the prioritized NEXT-TASK queue from the gated fleet proposals + THINK needs-research — safe-additive applies first, then risky edits (per-lane review), then research. The conductor never idles blindly.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-next.ts:*), Bash(npx tsx orchestration/bin/fleet-next.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-next.ts`. It reads the gated proposals and the THINK loop's NEEDS_RESEARCH flags, ranks the next tasks, and writes `orchestration/FLEET_NEXT.md`. Report the P1 safe-additive tasks (apply now through tsc → vitest → commit), the P2 edits (need per-lane review before apply — 0-hata), and the P3 research items. Then propose the single next action. See `.claude/BRAIN.md`.
