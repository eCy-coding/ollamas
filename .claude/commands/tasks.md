---
description: List the task catalog (TASKS.json) — every critical `ollamas do "<id>"` to complete the project, one grounded task per substantial module across all lanes.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/orchestra.ts --tasks:*), Bash(npx tsx orchestration/bin/orchestra.ts --tasks:*)
argument-hint: ""
---
Run `./node_modules/.bin/tsx orchestration/bin/orchestra.ts --tasks`.

Prints every catalog task (id + goal) from `orchestration/TASKS.json` — count derived from the real source
surface (not a round number), one task per substantial exported-symbol module. Rebuild with
`tsx orchestration/bin/gen-catalog.ts && tsx orchestration/bin/build-tasks.ts`. Run a task with `/do "<id>"`,
check completion with `/progress`, calibrate the whole pipeline with `/calibrate`. See `docs/TASKS.md`.
