---
description: Enqueue a task for the $0 conductor — resolves to its catalog target (or fuzzy-matches), grounds the local model, and proposes a gated fix. Argument = a catalog id or free-text task.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/orchestra.ts:*), Bash(npx tsx orchestration/bin/orchestra.ts:*)
argument-hint: "\"<catalog-id | free-text task>\""
---
Run `./node_modules/.bin/tsx orchestration/bin/orchestra.ts $ARGUMENTS`.

Enqueues the task (FIFO) into `~/.ollamas/orchestra.json`. The conductor's REPAIR phase resolves it to the
task's REAL target file via `lib/task-catalog.ts` (exact id → substring → token-overlap), grounds the local
model on that file, and writes a SEARCH/REPLACE `PROPOSAL.md`. With `orchestration/.orchestra-apply-enabled`
present it is gated (tsc+tests) and applied — reverted on red, so the tree never breaks. Report what was
enqueued + queue depth. Same as `ollamas do "<task>"`. See `/tasks` for the catalog, `/progress` for status.
