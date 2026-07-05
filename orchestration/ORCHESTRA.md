# ORCHESTRA — the $0 Claude-Code-free conductor (JUstdoit STEP 1-10)

Typing **`ollamas`** brings the whole project up and hands the baton to a **local, zero-cost model**
that conducts the build loop — no Claude Code, no cloud API. If the conductor model dies, a **joker**
takes over from persisted state and the system keeps running.

## The `ollamas` command

| Command | What it does |
|---|---|
| `ollamas` / `ollamas up` | Boot infra (`start.sh`: ollama serve + warm + host bridge + gate) → open a living conductor tab in **Terminal.app AND iTerm2** (`orchestra.ts --watch`). |
| `ollamas do "<task>"` | Enqueue a task (FIFO) into the running conductor — it routes through COUNCIL → BENCHMARK → REPAIR. |
| `ollamas status` | Print the conductor FSM one-liner. |
| `ollamas conductor [sec]` | Run the conductor loop inline (persistent). |
| `ollamas <anything else>` | Delegate to the existing zero-dep TS CLI (chat/agent/mcp/keys/…). |

**Install (one-time, operator/T0 decision — system mutation, not run automatically):**
```bash
bash orchestration/bin/install-ollamas-cmd.sh --print      # preview, mutates nothing
bash orchestration/bin/install-ollamas-cmd.sh              # symlink onto PATH + ~/.zshrc alias
bash orchestration/bin/install-ollamas-cmd.sh --uninstall  # reversible
```

## The conductor loop (`orchestra.ts` + pure FSM `lib/orchestra-fsm.ts`)

```
BOOTSTRAPPING → COUNCIL_DEBATE → BENCHMARK_VALIDATION → { DEPLOYMENT | REPAIR } → MONITORING
                                        REPAIR ⟳ (retry ≤ 3) → ESCALATE (daemon stays open)
```
- **Conductor model** = benchmark pick from `MODEL_SELECTION.json` (`qwen3-coder:30b`). Each tick OBSERVES
  read-only signals from the existing tools (`conduct --json` top-tier, `fleet-conduct --json` convergence);
  a timed-out/crashed child degrades to a **neutral** signal so the daemon never exits.
- **REPAIR** dispatches the fix to the local conductor model (proposal → `~/.ollamas/orchestra-proposals/`).
- **State** is resumable + atomic at `~/.ollamas/orchestra.json`; log at `~/.ollamas/orchestra.log`.
- **DEPLOYMENT** auto gate+commit is OFF unless `ORCHESTRA_APPLY=1` (outward-facing = operator decision).

## Joker failover (`lib/joker.ts`, JUstdoit STEP 5)

Each tick health-probes the conductor (present in `ollama list` + answers a 1-token turn within the
timeout). On failure → swap `conductor_model` to the healthy joker (`qwen3:8b`, kept warm), bump
`failover_count`, log `[FAILOVER] <old>→<joker>`, resume from the same state. No-thrash guard when no
healthy alternative exists (degrade, don't spin).

## Council decision (`lib/council.ts`, JUstdoit STEP 2)

`council --debate` now tallies a **weighted-majority quorum**: a lane clears quorum when >0.6 of responding
seats emit actionable findings → `decision: EXECUTE`, else `HOLD` (silence/tie → safe Orchestrator override).

## Turnkey 0-manual (continuous)

One command makes it self-sustaining:
```bash
bash orchestration/bin/install-ollamas-cmd.sh --full   # command (symlink+alias) + persistent conductor daemon
```
- **Persistent daemon:** `--daemon` writes `~/Library/LaunchAgents/com.ollamas.orchestra.conductor.plist`
  (`KeepAlive` → `orchestra.ts --watch`; survives crash, terminal-close, reboot). Logs
  `~/.ollamas/conductor.{out,err}.log`. Off with `--daemon-off`. Loading a LaunchAgent is a T0 system change.
- **`ollamas ready`** — preflight self-heal (`scripts/ready.mjs`: ollama/model/deps/gate detect + auto-fix).
  `ollamas` boot runs it as STEP 0 so a fixable prereq never blocks the boot (`--no-ready` skips).
- **Autonomous apply:** `touch orchestration/.orchestra-apply-enabled` → REPAIR applies gated fixes
  (tsc+tests, revert-on-red, no auto-commit) with no per-invocation env — so the daemon closes fixes
  0-manual. Remove the marker → propose-only (default).

## Parity (STEP 6): orchestra = default, claude-dispatch = opt-in

`orchestra.ts` is the **default, always-on $0 conductor** (local model, via `ollamas`/`--watch`).
`claude-dispatch.ts` is the **opt-in, human-gated escalation** to a paid Claude Code session for the rare
requirement a local model can't close — off unless `.claude-dispatch-enabled` + `--go`. The conductor runs
through `ollamas` (living tabs) / `--watch`, deliberately NOT piggy-backed on the SessionStart autopilot
refresh (a full model-generating tick per session would be a surprising side-effect).

## REPAIR = real gated fix (STEP 4)

REPAIR makes the conductor a fleet worker: it grounds the local model on a stream's focus file
(`lib/fleet-prompt`), gets a SEARCH/REPLACE proposal, writes it to
`~/.llm-mission-control/fleet/work/<stream>.orchestra/PROPOSAL.md`, and with `ORCHESTRA_APPLY=1` runs
`fleet-apply.ts --apply` (tsc + tests gate, reverted on red). Council `HOLD` short-circuits a no-consensus
tick to MONITORING (a queued task or a blocking signal overrides).

## Tests

`vitest run --project orchestra` — joker + FSM units + child-process chaos (failover, bounded
retry→ESCALATE, task lifecycle) + council quorum.
