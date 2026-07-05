---
description: Autonomous project-completion — toggle the auto-drain marker so the conductor works through the whole catalog 0-manual (idle → pull next PENDING task → propose → gated-apply → done). Argument = on | off | status.
allowed-tools: Bash(touch orchestration/.orchestra-autodrain-enabled), Bash(rm -f orchestration/.orchestra-autodrain-enabled), Bash(ls orchestration/.orchestra-autodrain-enabled:*), Bash(./node_modules/.bin/tsx orchestration/bin/orchestra.ts --once:*), Bash(./node_modules/.bin/tsx orchestration/bin/orchestra.ts --progress:*)
argument-hint: "on | off | status"
---
Autonomous backlog-drain control (opt-in — system self-completes when on).

- **`on`** → `touch orchestration/.orchestra-autodrain-enabled`. Now the conductor, when idle, pulls the next
  PENDING catalog task itself (no `/do` needed), proposes it, and — if `orchestration/.orchestra-apply-enabled`
  is also present — gated-applies (green→`done`, red→revert). Confirm with `/progress`.
- **`off`** → `rm -f orchestration/.orchestra-autodrain-enabled` (back to reactive: only `/do` tasks run).
- **`status`** → `ls orchestration/.orchestra-autodrain-enabled` (present = on) + `orchestra.ts --progress`.

SAFETY: drain only PROPOSES until the apply marker is also set; correctness = gate + revert-on-red (never
breaks the tree). Full autonomy (drain + apply) is an operator/T0 decision. Then the daemon completes the
project unattended — watch `/progress`.
