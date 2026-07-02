# BRAIN.md — ollamas orchestration system brain (knowledge hub)

> The single map of the autonomous multi-model orchestration system: what each mechanism is, how they
> connect, entry points, and the proven-solution knowledge. Referenced by CLAUDE.md / AGENTS.md.
> Build in English; report to the operator in Turkish. Claude Code = conductor (directs, controls,
> gives feedback) — it does not write feature code; lanes/workers do, gated by the conductor.

## 0. The loop (how a task flows end-to-end)

```
deepsearch/deepthink → PLAN (before any task) → dispatch (council/fleet) → gate (oracle + tsc/vitest)
   → THINK (detect problem → proven-solution registry → fix | NEEDS_RESEARCH) → verify → commit → repeat
                                   ↑___________________ autopilot 30-min loop (always-open) ___________________|
```
Every worker PLANS before executing (detect what's needed → mini-plan → then propose). No half-work.
The **E2E-loop** (`/loop`) wraps the whole chain: it repeats the pass above until convergence
(all acceptance ✅ + gate clean + P1 queue drained) or a bounded round cap, then reports honestly.

## 1. Mechanisms (entry points)

| Mechanism | What | Entry point | Slash |
|-----------|------|-------------|-------|
| **Council** | 18-model capability-matched project analysis + oracle verify + debate | `orchestration/bin/council.ts` | `/council` |
| **Fleet** | Terminal.app + iTerm2 living agent-tabs, ≤2/model, single-GPU FIFO, PROPOSE-only. `--sequenced` = ethical mission order (T1→Tn, tier-tagged). Workers read the REPO (fleet-launch sets `POST /api/workspace/select`=repo) read-only (`agent-dispatch --no-apply`, no repo mutation) via DIRECT `read_file` of the per-stream target → real gated Change/Diff/Test proposals (6/6 CONVERGED) | `orchestration/bin/fleet-launch.ts` + `bin/lib/{fleet-order,workspace}.ts` | `/fleet` |
| **Fleet-agent** | Persistent per-tab worker: PLAN→claim→GPU-ticket→dispatch(escalate+backoff)→self-gate→idle-heartbeat | `orchestration/bin/fleet-agent.ts` | (opened by `/fleet --go`) |
| **Fleet-conduct** | Conductor: read reports+claims → gate → FLEET_STATUS.md; `--watch` daemon; `--stop` kill | `orchestration/bin/fleet-conduct.ts` | `/fleet-stop` |
| **Fleet-watch** | Operator live-follow console (claims+verdict+log tail) | `orchestration/bin/fleet-watch.ts` | `/fleet-watch` |
| **THINK loop** | Detect problem → proven cited solution \| NEEDS_RESEARCH (no-guess); learns (append-only) | `orchestration/bin/think.ts` + `PROBLEM_REGISTRY.json` | `/think` |
| **Fleet-next** | Precompute next-task queue (safe-additive apply → risky-edit → research); workers also `## Next:` precompute | `orchestration/bin/fleet-next.ts` | `/fleet-next` |
| **Task list** | Persistent master-directive acceptance-criteria + DONE log + next (auto-refreshed, cross-session truth) | `orchestration/bin/tasklist.ts` → `docs/MASTER_TASKLIST.md` | `/tasklist` |
| **Autopilot** | 30-min always-open loop: benchprompt→council→fleet→critic→dod→conduct→fuse→think→next→tasklist→status→dispatch→doctor | `orchestration/bin/autopilot.ts` | (launchd) |
| **E2E-loop** | Runs the autopilot chain until CONVERGED (bounded 3 rounds; `--watch` persistent), detects convergence honestly → `docs/E2E_LOOP.md` | `orchestration/bin/loop.ts` + `bin/lib/loop.ts` | `/loop` |
| **Mission** | Sequences the parallel fleet into step-by-step (T1→Tn) dependency-ordered tasks, ≤2/model, ethical tool-tier per step (never `privileged`) → `orchestration/MISSION.md` | `orchestration/bin/mission.ts` + `bin/lib/mission.ts` | `/mission` |
| **Chrome-probe** | Hands every model the same task one-by-one (sequential), classifies which are capable (shell-tool ok + DONE/OK, not demo). `--task open` → open Chrome (`CHROME_PROBE.md`); `--task shortcuts` → open Chrome + list dev/AI keyboard shortcuts, scored vs 14-combo ground-truth (`CHROME_SHORTCUTS.md`). Operator-authorized privileged use on own Mac | `orchestration/bin/chrome-probe.ts` + `bin/lib/chrome-probe.ts` | `/chrome-probe` |
| **Automator-probe** | Hands every model the same task one-by-one (sequential): author Automator artifacts supporting ollamas, then TRACKS what each produced via a directory scan (produced = ≥1 file, verdict-independent). `--task support` → general artifacts (`AUTOMATOR_PROBE.md`); `--task daily` → DAILY recurring automations (launchd `StartCalendarInterval` / Calendar Alarm), content-scanned by `detectSchedule` to verify recurrence → `AUTOMATOR_DAILY.md`. `--loop` → bounded convergence loop (hesapla pending → planla retry-set +steps → kodla re-dispatch) until all models recurring → `AUTOMATOR_LOOP.md`. Scoped per-model writes; produced + tracked, never installed/executed | `orchestration/bin/automator-probe.ts` + `bin/lib/automator-probe.ts` + `bin/lib/automator-loop.ts` | `/automator-probe` |
| **Automator-best** | Synthesizes the daily-loop's recurring automations into ONE install-ready bundle: ranks by completeness, validates the top candidates (`plutil -lint` + `bash -n`, syntax only, never run), copies the best VALID one to `~/Desktop/ollamas-daily/BEST/` + one-command `launchctl load` INSTALL.md → `AUTOMATOR_BEST.md`. Nothing installed/run (operator's choice) | `orchestration/bin/automator-best.ts` + `bin/lib/automator-best.ts` | `/automator-best` |
| **Fleet-run** | The ONE end-to-end driver (systematic work algorithm / automated lieutenant): preflight (bridge+server+workspace=repo) → launch (`--go --sequenced`, T1→Tn, ≤2/model) → conduct loop (poll until every stream gated, bounded rounds; living workers self-retry) → report → `FLEET_RUN.md`. Claude=conductor; workers PROPOSE-only --no-apply | `orchestration/bin/fleet-run.ts` + `bin/lib/fleet-run.ts` | `/fleet-run` |
| **Term-exec** | Run a bash / Apple-terminal command in a REAL visible Terminal.app / iTerm2 window on the host + capture output & exit code, via the bridge `/run` (the privileged macos_terminal capability as a first-class operator CLI). `--check` verifies the authority end-to-end (terminals + live probe exit 0 + Automation permission). Token-authed, loopback, watchdog-timed | `orchestration/bin/term-exec.ts` + `bin/lib/term-exec.ts` | `/term-exec` |
| **Oracle** | Deterministic ground-truth (TRUE/FALSE/UNDECIDABLE + proof); LLM-free | `orchestration/oracle/index.ts` | — |
| **Claims** | Atomic collision-free work ledger (LWW+fence, TTL) | `orchestration/bin/lib/claims.ts` | — |

## 2. Proven solutions (evidence-based, cited — see PROBLEM_REGISTRY.json)

| Problem | Proven fix | Source | In code |
|---------|-----------|--------|---------|
| GPU starvation | FIFO ticket-lock (bakery, starvation-free) | Lamport bakery · Ollama FAQ · Node worker-pool | `bin/lib/gpu-lock.ts` |
| Transient cloud error | Exponential backoff + FULL JITTER, fail-fast non-transient | AWS Prescriptive Guidance / Builders' Library | `bin/lib/backoff.ts` |
| Machine saturation | Per-class limit + skip-done idempotency; 1 local + N cloud | Node worker-pool · Ollama NUM_PARALLEL | `fleet-agent.ts` |
| Model can't gate | Conductor escalation: read real source + author proposal (honest attribution) | project directive + evidence | `<stream>.conductor.json` |
| Tab vanished | Persistent agent + `exec $SHELL` (one-shot exits close tab) | macOS Terminal/iTerm2 default | `fleet-launch.ts` openTab |

## 3. Immutable principles (from AGENTS.md §2 + operator directives)

1. **Evidence only** — no guessing; every fix cites a source or is flagged NEEDS_RESEARCH.
2. **No half-work** — a stream is done only when gated (verdict + `## Change` + oracle where checkable).
3. **Single-GPU truth** — never run N local models expecting parallelism; FIFO-serialize, cloud parallelizes.
4. **PROPOSE, not mutate** — weak models produce proposals in isolated roots; conductor gates before apply.
5. **Report to conductor, not operator** — workers never ask the operator; the conductor asks nothing mid-run.
6. **Report TR, build EN.** · **Kill-switch exists** (`/fleet-stop`) — sustainable ≠ unstoppable.

## 4. Skill

`.claude/skills/fleet-orchestrator/SKILL.md` packages this whole workflow (when-to-use + the loop + the
slash commands). Sub-agent `.claude/agents/fleet-lieutenant.md` = the "emir eri" that relays conductor
directives to the worker models when Claude drives.
