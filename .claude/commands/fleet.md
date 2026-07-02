---
description: Launch the local model-fleet across Terminal.app + iTerm2 — persistent living agents, ≤2 tasks/model, single-GPU FIFO ticket-lock, PROPOSE-only. Claude stays conductor.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-launch.ts:*), Bash(npx tsx orchestration/bin/fleet-launch.ts:*)
argument-hint: "[--go] [--sequenced] [--cloud-only] [--streams a,b]"
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-launch.ts $ARGUMENTS` from the repo root.

Default (no `--go`) is a DRY RUN — print the plan (stream → Terminal.app/iTerm2 model, local/cloud, ≤2/model invariant) and the wrapper commands, open NO windows. Add `--go` to actually open the persistent living-agent tabs.

**`--sequenced`** (vO38): order the tabs by the sequenced ethical MISSION (T1→Tn dependency order via `lib/fleet-order.ts` + `buildMission`/`DEFAULT_DEPS`) — foundation-first (shell-harden → mjs-migration → typescript-core → {errors,concurrency} → test-coverage), each launch line tagged with its `T#·tier` (safe/host, never privileged). Backward-compatible (without the flag the order is unchanged). Live-proven: `--go --sequenced --cloud-only --streams shell-harden` opens a real Terminal.app tab running a persistent `fleet-agent` that logs to `~/.llm-mission-control/fleet/logs/<stream>.<slot>.log` (follow with `/fleet-watch`). Opening tabs needs macOS Automation permission for osascript (System Settings → Privacy → Automation).

After it runs: report the assignment table (stream · Terminal.app model · iTerm2 model · runtime), the ≤2/model check, and the single next command (`/fleet-watch` to follow live, `/fleet-stop` to kill). The system truth: 1 local + N cloud parallel; local slots serialize via the FIFO ticket-lock (`orchestration/bin/lib/gpu-lock.ts`). See `.claude/BRAIN.md`.
