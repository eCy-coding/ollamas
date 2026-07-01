---
description: Follow the model-fleet live — per stream/slot claim state + report verdict + last log lines (the operator's live-follow console).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-watch.ts:*), Bash(npx tsx orchestration/bin/fleet-watch.ts:*), Bash(tail:*)
argument-hint: "[--watch]"
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-watch.ts $ARGUMENTS`.

Without `--watch` it prints one live snapshot; with `--watch` it refreshes on the alt-screen every few seconds (Ctrl-C restores). Per-worker `.log` files are also tail-able: `tail -f ~/.llm-mission-control/fleet/logs/<stream>.<slot>.log`. Report the snapshot verbatim and note which streams are gated-DONE vs in-progress vs BLOCKED.
