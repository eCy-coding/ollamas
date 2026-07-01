---
description: Regenerate the persistent master task list (docs/MASTER_TASKLIST.md) — the operator's recurring master-directive as auto-refreshed acceptance-criteria + DONE log + next-task queue.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/tasklist.ts:*), Bash(npx tsx orchestration/bin/tasklist.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/tasklist.ts`. It gathers live data (git log, FLEET_NEXT, THINK, CODINGS_STATUS) + the durable vO history and writes `docs/MASTER_TASKLIST.md`. Report the acceptance count (N/total), CODE_PLAN streams DONE, whether the full gate is clean (no GATE_SKIP), and the next-task queue. This file is the durable cross-session source of truth. See `.claude/BRAIN.md`.
