# ORGANIZATION.md — The ollamas Unified Management & Organization Charter

> The single English master charter for how the ollamas ecosystem is **managed and organized**: who
> commands, who executes, who verifies, how work is routed, how every operation is remembered, and how
> the same mistake is structurally prevented from happening twice.
> Machine-readable twin: `ORG_CHART.json` (+ council seats merged from `COUNCIL_ROSTER.json`).
> Engine: `bin/lib/organization.ts` · IO: `bin/lib/org-io.ts` · Memory: `bin/lib/brain-ledger.ts`.
> Operator ritual: `MANAGEMENT.md`. Calibration proof: `bin/calibrate-org.ts` → `CALIBRATION-ORG.md`.

---

## 1. Design rationale — the researched management patterns we run on

The management system is not invented from scratch; it is the composition of four battle-proven
organizational patterns, each already latent in the codebase and now made explicit:

1. **Hierarchical conductor with a supervisor tree (Erlang/OTP restart semantics).** One conductor
   (`qwen3-coder:30b`) drives the loop; a warm **joker** (`qwen3:8b`) is its supervisor-tree sibling that
   restarts the work *from persisted state* when the conductor dies. Failure is expected and survivable,
   never fatal (`orchestra.ts` health-gate + `lib/joker.ts`). The chain of command is short and explicit:
   **T0 Emre → ollamas mission control → conductor → workers/seats**.
2. **Blackboard architecture.** All actors communicate through shared, inspectable state — the
   `~/.ollamas/*.json` ledgers, `orchestration/*.json` artifacts, and now the **brain ledger**
   (`~/.ollamas/brain-ledger.jsonl`). Nobody whispers; every decision leaves a record on the blackboard.
3. **OODA loop (observe → orient → decide → act).** Each FSM tick observes read-only signals
   (`conduct`/`fleet-conduct`), orients via the council + hierarchy policy, decides the next phase in a
   pure FSM (`orchestra-fsm.ts`), and acts through bounded, gated side-effects. The management layer adds
   a mandatory **orient sub-step: consult the error registries** before every act.
4. **Capability-based, cheapest-capable routing.** A task is matched to the *cheapest* actor whose
   capability tags cover it (costRank 0 local → 1 free-cloud → 2 external service), exactly mirroring the
   Wilson-gated cheapest-tier ladder in `lib/hierarchy.ts resolveTierForClass`. Escalation is a ladder,
   never a jump: local → sonnet → opus; actor → its `escalatesTo` → T0.

No new frameworks are imported. $0, zero-dep, local-first.

**v2 — academic grounding pass (`RESEARCH-ORG.md`, 10 models surveyed, cited).** Three additional
idea-adoptions landed in the engine: **Contract-Net-lite** (Smith 1980) — every capable actor
implicitly bids its ledger evidence (Wilson lower bound of its success rate) and `assignRole` awards
within the cheapest cost band (thin evidence n<3 bids neutral); **MAPE-K** (Kephart & Chess 2003) —
the sandbox harness (`bin/org-sandbox.ts`) runs Monitor→Analyze→Plan→Execute rounds over the ledger
as Knowledge; **OTP restart-elsewhere** — an actor that failed a task is never re-dispatched to it
(recurrence detection via failure signatures; a second same-signature failure hardens the proposal to
`RECURRENCE ×N` and forces the escalation ladder). MetaGPT-style SOP briefs (role + duties + verbatim
rules + recalled memory) are the worker interface.

## 2. The organization (who does what)

| Actor | Kind | Role | Reports to | Escalates to |
|---|---|---|---|---|
| **Emre** | operator | T0 Commander — final decisions, outward-facing approvals | — | — |
| **ollamas** (:3000) | service | Mission Control — blackboard, ProviderRouter, ToolRegistry choke-point | Emre | Emre |
| **conductor** (qwen3-coder:30b) | model | Runs the FSM build loop; authors gated proposals | ollamas | joker |
| **joker** (qwen3:8b) | model | Warm standby conductor + fast-verify seat | conductor | Emre |
| **odysseus** (:7860) | service | External specialist (research/agent) via MCP bridge | ollamas | conductor |
| **ecym** | cli | Emre's personal router (classify → cheapest lane) | Emre | ollamas |
| **vision** (qwen2.5vl:32b) | model | UI/screenshot/diagram analysis | conductor | conductor |
| **librarian** (nomic-embed-text) | model | Embeddings: search, dedupe, recall | conductor | conductor |
| **cloud-pool** | pool | Surge capacity (1 local + N cloud rule) | ollamas | Emre |
| **council seats** (14) | model | Debate/verify per `COUNCIL_ROSTER.json` (architect, verifier, adversary, triage, …) | conductor | conductor |

Council seats are merged from `COUNCIL_ROSTER.json` at load time — the roster remains their single
source of truth; `ORG_CHART.json` never duplicates them.

## 3. The dispatch ritual (every task, no exceptions)

```
consult-errors → assign → brief → dispatch → record → distill
```

1. **consult-errors** — `consultErrors()` scans ALL error registries (`orchestration/errors_registry.json`,
   `contract/errors_registry.json`, `tunnel/errors_registry.json`, `PROBLEM_REGISTRY.json`) plus the
   actor's `knownFaults` for entries relevant to the task. Matching prevention rules are *mandatory input*
   to the brief. A dispatch that ignores a known prevention rule is a defect by definition.
2. **assign** — `assignRole()` picks the cheapest capable actor from the merged org chart
   (capability match, then costRank ascending, then roster order). No capable actor → escalate up the
   ladder, ultimately to T0.
3. **brief** — `buildDispatchPrompt()` produces the worker brief: role, duties, goal, and a verbatim
   **NEVER REPEAT** block containing every matched prevention rule.
4. **dispatch** — the existing machinery executes (orchestra REPAIR, council seat, bridge call). The
   management layer never bypasses the gates: PROPOSE-not-mutate, tsc+tests, revert-on-red.
5. **record** — `recordOutcome()` writes an **episodic** brain-ledger entry for every dispatch (success
   AND failure). A failure additionally synthesizes a registry-append **proposal** (PROPOSE-mode file,
   gated) with a one-sentence `prevention_rule`.
6. **distill** — recurring lessons get promoted to the **learned** tier and, once proven, into the error
   registries / `PROBLEM_REGISTRY` (append-only, source-cited).

## 4. Memory policy (nothing is forgotten)

- **Every** dispatch and outcome → `brain-ledger.jsonl` (episodic tier), append-only, atomic.
- **Every** distilled failure → `learned` tier + registry-append proposal with a prevention rule.
- The ledger adapter (`brain-ledger.ts`) mirrors the full brain API (`remember`/`recall`); when the
  parent lane fast-forwards the 5-tier brain into main, the backend swaps to `/api/brain/*` with zero
  call-site changes.
- Recall is consulted at dispatch time (same query path as consult-errors) — memory is an input, not
  an archive.

## 5. Hard laws (violation = defect)

1. **Root cause before symptom.** No fix ships without the root cause named.
2. **Evidence before claims.** "It works" = the command was run and its output shown.
3. **PROPOSE, don't mutate.** Workers propose; gates apply; red reverts.
4. **Cheapest capable actor first.** $0 local before free cloud before external; escalate on evidence only.
5. **Consult before dispatch.** No task leaves without its prevention rules attached.
6. **Record everything.** A dispatch without a ledger entry did not happen.
7. **Never repeat a registered error.** Recurrence bumps `recurrence_count` and hardens the rule.
8. **Targeted commits only.** `git add -A` is forbidden in this shared tree (ERR-ORCH-006).
9. **Outward-facing = T0.** Publishing, daemons, symlinks, policy changes are Emre's call.
10. **Build in English, report in Turkish.**
