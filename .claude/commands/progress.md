---
description: Show project-completion progress — done/total from the task ledger plus a per-lane breakdown.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/orchestra.ts --progress:*), Bash(npx tsx orchestration/bin/orchestra.ts --progress:*)
argument-hint: ""
---
Run `./node_modules/.bin/tsx orchestration/bin/orchestra.ts --progress`.

Reads the completion ledger (`~/.ollamas/tasks-progress.json`, `lib/task-progress.ts`): `done X/N · proposed ·
pending` + per-lane done/total. `done` = a catalog task whose gated apply landed green; `proposed` = a
PROPOSAL was written. The autonomous drain (`/drain`) advances these 0-manual. Report the totals + which lanes
are furthest behind.
