# SERVICES.md — The 25 Critical µ-Services of the ollamas Working Principle

> The complete decomposition of the management/organization working principle into 25 critical,
> single-responsibility, independently self-testable services under ONE uniform contract —
> plus the 4 real network daemons. Registry code: `bin/lib/services.ts` · runner: `ollamas services`
> (`bin/services.ts`) · machine artifact: `SERVICE_REGISTRY.json` (regenerated on every health run).

## Architecture decision — why in-process µ-services, not 25 daemons

At $0/local/single-GPU scale, 25 network daemons would buy distribution costs (ports, serialization,
partial failure, ops) with zero distribution benefit. The honest form of the microservice principle
here is the **modular monolith**: the value of microservices is the *modules* — explicit boundaries,
independent testability, uniform health contracts — and peeling a module into a network service later
is only possible when those boundaries already exist ([Fowler, MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html) ·
[Microservices Guide](https://martinfowler.com/microservices/)). The four services that genuinely need
process isolation ARE network daemons and are registered as such (`net:*`).

**The contract** (`ServiceSpec`): `id · kind(pure|io) · role · deps[] · source · selftest()`.
Every selftest calls the service's REAL exported functions with a deterministic canary and returns
`{ ok, evidence }` — no GPU, no network, no repo mutation (io selftests isolate under a temp
`ORG_STATE_DIR`). `validateRegistry` enforces: exactly 25, unique ids, resolvable deps.

## The 25 (+4 network)

| # | id | kind | role |
|---|----|------|------|
| 1 | org-chart | pure | Role registry: parse + council-roster merge |
| 2 | role-router | pure | Cheapest-capable assignment (+avoid, +bandPick) |
| 3 | error-consult | io | Prevention-rule lookup over ALL registries |
| 4 | brief-builder | pure | SOP worker brief (NEVER-REPEAT verbatim + memory) |
| 5 | outcome-recorder | pure | Outcome→ledger entry + ERR-ORG proposal |
| 6 | recurrence-detector | pure | Failure signatures + same-error counting |
| 7 | brain-ledger | io | Sync memory: remember/recall (+brain mirror) |
| 8 | authority-trainer | pure | Learned authority (wilson curriculum) |
| 9 | bandit-selector | pure | UCB1 explore/exploit in the cheapest band |
| 10 | authority-gate | pure | allowedAction rank enforcement |
| 11 | learning-eval | pure | Learning curve + cumulative regret |
| 12 | task-tracker | pure | Live-progress reducer + rendering |
| 13 | tracker-bus | io | Event log + state cache (multi-producer safe) |
| 14 | follow-viewer | pure | `ollamas follow` frame rendering |
| 15 | sandbox-runner | pure | MAPE-K chaos round core |
| 16 | calibration | pure | Dispatch-ritual mini-calibration |
| 17 | hierarchy-router | pure | Wilson-gated cheapest-tier resolution |
| 18 | joker-failover | pure | Supervisor-tree conductor failover |
| 19 | gpu-lock | pure | Starvation-free FIFO ticket lock |
| 20 | backoff | pure | Full-jitter bounded retry |
| 21 | council-core | pure | Weighted votes → quorum decision |
| 22 | task-catalog | pure | Grounded task resolution |
| 23 | task-progress | pure | Completion ledger |
| 24 | think-solver | io | Problem → proven cited solution |
| 25 | org-status | io | Live overview aggregator (:3000 /org) |
| — | net:ollamas | network | Mission control server :3000 |
| — | net:odysseus | network | External specialist :7860 |
| — | net:pulse | network | Health dashboard :4777 |
| — | net:ollama | network | Model runtime :11434 |

## Running

```bash
tsx orchestration/bin/services.ts --list              # table
tsx orchestration/bin/services.ts --health            # one-by-one selftests + network probes,
                                                      # streamed as a live 25-item checklist
tsx orchestration/bin/follow.ts                       # watch the health run live
```

First full run (2026-07-18): **29/29 healthy** — every selftest with evidence, network probes 200.
Regression guard: `orchestration/tests/services.test.ts` runs all 25 selftests in the suite.
