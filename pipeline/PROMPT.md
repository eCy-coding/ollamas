# eCym Pipeline — Master Prompt v3.0 (executable)

> **This document is executable.** Every claim below is produced by `pipeline/` on this
> machine and re-measured on each full run. The `MEASURED` block at the bottom is written by
> `pipeline/lib/prompt-sync.ts`; nothing outside its markers is auto-edited.
>
> Run it: `ollamas pipeline run --profile simple` · Benchmark it: `ollamas pipeline bench --runs 5`
> · Audit it: `ollamas pipeline audit` · See the DAG: `ollamas pipeline explain`

---

## 1. What this is

An 18-step, evidence-based AI pipeline with no blind spots:

```
search → think → analyze → plan → todo → sandbox_test → think → analyze → test →
true_or_false → chaos_test → security_scan → coverage_check → code → test →
merge → commit → push
```

It is **not a prompt an LLM answers**. It is a DAG (`pipeline/workflow.json`) executed by an
orchestrator that measures every step, evaluates hard SLOs, injects faults, scans for
vulnerabilities, and refuses to call itself complete when any capability went unexercised.

## 2. Where each step actually runs

| step | system | implementation |
|---|---|---|
| `search` | **obsidian** | `cckb ask --json` — capsule layer, ~1 KB, network-free, P@1 = 1.0 |
| `think` / `analyze` / `plan` / `code` | **ollamas** | `:3000/v1/chat/completions` (free providers) + 24 h cache |
| `todo` | **ollamas + obsidian** | orchestra kanban (`orchestra/sprint.md`) that actually executes |
| `sandbox_test` | docker | warm pool, `alpine:3.20`, `--network none`, per-pool label |
| `test` / `coverage_check` | ollamas | vitest + v8 `json-summary` |
| `security_scan` | — | semgrep + bandit, blocks on `high`/`critical` |
| `chaos_test` | — | `latency:200ms` + `partition`, decision re-checked under fault |
| `merge` / `commit` / `push` | git | dry by default; `push` additionally operator-gated |

Consumers: **claudecode** (`/pipeline` + skill), **eCym** (`ecym "pipeline calistir"`),
**ollamas** (`ollamas pipeline`, metrics on `GET /metrics`), **obsidian** (run reports under
`orchestra/runs/`, hub `[[pipeline]]`).

## 3. Deviations from the source prompt, and why

The source assumed a cloud CI. This machine is local, $0 and memory-constrained. The spec's
*intent* is met; its infrastructure assumptions are not copied blindly.

| source | here | reason |
|---|---|---|
| k6 / Artillery | `pipeline/lib/loadgen.ts` (zero-dep, closed + open loop, k6-shaped summary) | neither is installed; a new heavyweight dep on a swapping laptop buys nothing |
| Prometheus Pushgateway | the existing `prom-client` registry on `GET /metrics` | already live; a Pushgateway is a second always-on service |
| S3 + SHA-256 | vault `orchestra/runs/` + git, content-hashed | local, $0, already backed up daily |
| GitHub Actions | local pre-commit gate + `pipeline/verify.sh` (a workflow YAML is kept for parity) | the enforcing gate must be where the work happens |
| coverage ≥ 90 % repo-wide | ≥ 90 % on `pipeline/lib/**`, repo floor stays 70 | raising the global floor would be false; the new pure core can honestly meet 90 |

## 4. Rules the implementation never breaks

1. **Absent evidence is not a pass.** A gate with no measurement reports `MISS`, never `PASS`.
   A scan that did not run is not "clean"; chaos that did not run is not "resilient".
2. **A failing step is recorded, not fatal.** Aborting on first failure makes error-rate
   unmeasurable and turns every later gate into a misleading `MISS`.
3. **Self-audit downgrades the run.** Gaps in the checklist (observability, caching,
   parallelism, warm-pool, CI-gate, security, chaos, coverage, reproducibility, repetition)
   mark the run `incomplete` and file a corrective task — even when every SLO passed.
4. **Weak evidence is surfaced, not smoothed.** `n < 3` or `cv > 0.3` sets `weak_evidence`
   alongside the decision instead of quietly relaxing it.
5. **Cost and correctness are separate gates.** A cheaper answer is not a better one.
6. **Nothing leaves the machine unattended.** `merge`/`commit` are dry; `push` needs
   `--allow-push` and still does not fire automatically.

## 5. Quality gates

| gate | limit |
|---|---|
| `p95(think)` | ≤ 350 ms *(see corrections — unreachable with real inference)* |
| `p95(sandbox_test)` | ≤ 2000 ms |
| `p95(total)` | ≤ 3000 ms |
| `error_rate` | < 0.1 % |
| `coverage` | ≥ 90 % on `pipeline/lib/**` |
| `security` | no `high` / `critical` |
| `chaos` | ≥ 95 % success under injected faults |
| evidence | ≥ 3 runs, `cv` ≤ 0.3 |

## 6. References

Anchored and liveness-checked in the vault: `[[pipe-kaynaklar]]`
(`_bin/pipe-anchors.py --check`). Each anchor records **which design decision rests on it**,
not a copy of the page.

1. Benchmarking Distributed Systems — percentiles, ≥3 runs, variance
2. AWS Well-Architected — load-testing anti-patterns, SLOs, CI integration
3. DevX — "average latency is misleading"; hypothesis-driven benchmarks
4. Artillery — CI-run load tests, warm-up discipline
5. grafana/k6 — closed/open-loop load models, summary schema

## 7. Verification

```bash
ollamas pipeline explain                 # DAG: waves, parallel sets, parallelism factor
ollamas pipeline run --profile simple    # one measured run, artefact + prompt sync
ollamas pipeline bench --runs 5 --full   # 3 profiles × 5 runs, percentiles + variance
ollamas pipeline audit                   # what the last run left unproven
zsh pipeline/verify.sh                   # 4-system end-to-end gate
npx vitest run --project pipeline --coverage
```

---

<!-- MEASURED:BEGIN — auto-generated by pipeline/lib/prompt-sync.ts. Do not edit inside. -->

## 📊 MEASURED — last real run (auto-updated, do not hand-edit)

run_id `e2ee0725-56cc-4332-b3de-547321d7e696` · 2026-07-24T10:33:21.267Z · profile `simple` · workflow v3.0
env darwin 24.6.0/arm64 · cpu 16 · mem 51.5 GB · node v24.16.0 · git `ba427942`

### End-to-end latency

| metric | value |
|---|---:|
| p50 | 1928 ms |
| p95 | 1928 ms |
| p99 | 1928 ms |
| p999 | 1928 ms |
| stddev | 0 ms |
| cv | 0 |
| 95% CI | [1928, 1928] ms |
| runs (n) | 1 |

### Where the budget goes (step p95)

| step | p95 ms | n |
|---|---:|---:|
| coverage_check | 666 | 1 |
| test | 549 | 1 |
| chaos_test | 542 | 1 |
| test_code | 455 | 1 |
| security_scan | 261 | 1 |
| sandbox_test | 38 | 1 |

### Quality gates

| gate | measured / limit |
|---|---|
| p95(think) | PASS 5 / 350 |
| p95(sandbox_test) | PASS 38 / 2000 |
| p95(total) | PASS 1928 / 3000 |
| error_rate | PASS 0 / 0.1 |
| coverage | PASS 99.65 / 90 |
| security | PASS 0 / no high/critical |
| chaos | PASS 1 / 0.95 |

**decision:** `go_ahead=true` _(weak evidence)_ — all gates pass but evidence is weak (n=1, cv=0.00)
**status:** `incomplete` — self-audit gaps: repetition
**efficiency:** cache hit 0.778 · parallelism 1.2× · error rate 0%

### Corrections to this prompt (measured, not assumed)

- `p95(think) ≤ 350 ms` is unreachable with real LLM inference over free cloud providers — measured 566–1991 ms. The prompt's own baseline table already lists think p95 = 420 ms, which violates its own gate.
- The claimed "2–3× throughput from parallelism" is not available on this DAG: data dependencies make the research chain strictly sequential. Measured parallelism factor 1.06× → 1.2× after marking every genuinely independent step.
- `merge` originally consumed only `generated_code` + `code_test_report`, so security/coverage/chaos results were computed and then ignored — gates that cannot block are decoration. They are now merge inputs.
- A token/byte gate alone is unsafe: a naive `cckb` replacement produced SMALLER output (418 B vs 1039 B, "60× cheaper") while retrieval quality collapsed to P@1 = 0.0. Cost and correctness need separate gates.

<!-- MEASURED:END -->
