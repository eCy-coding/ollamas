---
description: The ONE command that runs the fleet end-to-end (systematic work algorithm) — PREFLIGHT (bridge + server + workspace=repo) → LAUNCH (Terminal.app + iTerm2 tabs, sequenced T1→Tn, ≤2/model) → CONDUCT LOOP (poll until every stream is gated, bounded rounds; living workers self-retry) → REPORT (done/missing). Claude = conductor; this is the automated lieutenant. Workers are PROPOSE-only --no-apply (never mutate the repo).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-run.ts:*), Bash(npx tsx orchestration/bin/fleet-run.ts:*)
argument-hint: "[--cloud-only] [--streams a,b] [--rounds 3] [--dry]"
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-run.ts $ARGUMENTS`.

It is the systematic end-to-end fleet driver — the automated "lieutenant" (`.claude/agents/fleet-lieutenant.md` is the interactive Claude-subagent variant):
1. **Preflight** — checks the host bridge (:7345) and ollamas server (:3000) are up, and sets the agent workspace to the repo (`POST /api/workspace/select`) so workers can read repo files. Fails fast with fix hints if bridge/server are down.
2. **Launch** — `fleet-launch --go --sequenced` opens the living-agent tabs in mission order (T1→Tn, tier-tagged, ≤2/model). `--cloud-only` for GPU-safe.
3. **Conduct loop** — polls `fleet-conduct --json` for a bounded number of rounds (`--rounds`, default 3) until every stream has a gated proposal. The persistent workers self-retry (steps 8→12→16); the driver collects rather than double-dispatching.
4. **Report** — writes `orchestration/FLEET_RUN.md` (per-round progress + which streams are gated/pending) and prints a TR summary.

Flags: `--cloud-only`, `--streams a,b`, `--rounds N`, `--dry` (preflight + plan without launching). Live-follow with `/fleet-watch`; kill with `fleet-conduct --stop`. See `.claude/BRAIN.md`.
