---
description: The $0 Claude-Code-free conductor — run the local-model orchestra FSM loop (BOOTSTRAP→COUNCIL→BENCHMARK→{DEPLOY|REPAIR}→MONITORING) with live joker failover. One tick, a persistent watch daemon, or a status read.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/orchestra.ts:*), Bash(npx tsx orchestration/bin/orchestra.ts:*)
argument-hint: "[--once | --watch <sec> | --status]"
---
Run `./node_modules/.bin/tsx orchestration/bin/orchestra.ts $ARGUMENTS`.

The local benchmark-picked model (`qwen3-coder:30b`, joker `qwen3:8b`) conducts — NO Claude Code, NO cloud
API. `--once` = one FSM tick; `--watch <sec>` = persistent daemon (never exits; a timed-out child degrades to
a neutral signal); `--status` = the FSM one-liner. State + log at `~/.ollamas/orchestra.{json,log}`. If the
conductor model dies mid-tick, the joker takes over from the same state (`failover_count++`). Report the phase,
conductor model, and any failover. See `orchestration/ORCHESTRA.md`, `.claude/BRAIN.md`.
