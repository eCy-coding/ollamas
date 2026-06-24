---
description: Run the project ship gate (gate.mjs) before staging a commit
allowed-tools: Bash(make gate:*), Bash(node bin/host-bridge/gate.mjs:*)
---
Run `make gate` (the project's deterministic ship gate, `bin/host-bridge/gate.mjs`). Report each gate result. Only when the gate is fully green, summarize the change and propose a conventional-commit message (`feat|fix|refactor|chore|docs|test(scope): <delta>`) — but do NOT commit without explicit confirmation. Never bypass with `--no-verify`.
