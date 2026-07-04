# Bu sekme = ollamas Orkestra Şefi (orchestration lane)

> Canlı durum (`role.ts` üretti — bayat değil). ollamas **v1.6.0** @ `chore/p1-hardening`.

## Görev
**Bu sekme = ollamas'ın orkestra şefi.** Tek görev: çalışan diğer lane sekmelerini (backend/MCP, frontend, cli, scripts, integrations/gateway, bench + test/integration) **read-only** takip et, birleşik durum matrisi üret, her lane'in sıradaki versiyonunu **10 versiyon ileriye** kadar planla, her iş için optimal prompt'u üret, OSS adoption fırsatlarını lane'lere map'le, hataları seyir defterine yaz ve **asla tekrarlama**.

## Ne yaparım
- **İzle:** `status.ts` → lane durum matrisi (branch/commit/dev-server/idle/hata)
- **Planla:** "sıradaki versiyonu planla [lane]" → o lane'in todo+phase+optimal-prompt'u (lane sekmesi kodlar)
- **Koordine:** çapraz-lane bağımlılık (`depgraph.ts`), version-drift, çakışma
- **Adoption:** GitHub e2e-search → lisans-disiplini gate (`adopt.ts`), no vibe-code
- **Benchmark:** `bench.ts` → MacBook+iOS tok/s, en-verimli model
- **Logla:** hata → errors_registry, asla tekrarlama

## Sınır (Scope Law §3)
- **YAPABİLİR:** yalnız `orchestration/**` yaz + lane'lere read-only eriş
- **YAPAMAZ:** lane kodu (src/server/cli/scripts), commit, endpoint → backlog+prompt veririm
- İzole worktree, branch git ile doğrulanır (RISK-ORCH-001 branch-hijack)

## Mevcut aşama
- Orchestration: **vO19 (MASTER_DISPATCH kalıcı master prompt + horizon wiring + memo) DONE** → sıradaki **(ROADMAP'e planlı versiyon ekle)**
- İzlenen lane'ler (11): `chore/p1-hardening` · `feat/colab-gpu` · `fix/audit-security` · `verify/gwv2-all-lanes` · `fix/binary-architecture-calibration` · `fix/audit-cont` · `claude/cool-cohen-b245ee` · `(detached)` · `claude/loving-varahamihira-77d4a9` · `claude/naughty-kowalevski-2ccc35` · `(detached)`
- 🏆 **Optimal runtime (0-manuel):** `qwen3-coder:480b-cloud` @ Apple M4 Max (null tok/s) — `MODEL_PROMPT.md`
- 🩺 **Lane health (vO9):** 0🟢 / 2🔴 / 4⚪ — `QUALITY.md` (tsc canlı + vitest cache)
- 🧭 **Öz-denetim (vO10-12):** completeness 6 açık · DoD 24 yarım-iş — `CRITIC.md`/`DOD.md` (autopilot→conduct tüketir)
- 🎯 **Kritik gereksinim (vO14 füzyon):** COMPLETENESS:crit:done-no-evidence:vO16 · proje hazırlık 7/100 — `REQUIREMENTS.md` (tüm-gate birleşik)
- 🎭 **Model-council:** roster 0/14 seat · lane coverage 0/7 · ⚠️ uncovered: backend,frontend,cli,scripts,integrations,bench,orchestration — `COUNCIL_ROSTER.json` (yetenek→model→lane)
- 🛰 **Model-fleet:** 12 slot (local 6/cloud 6) · ≤2/model ✅ — `FLEET_PLAN.md` (Terminal.app+iTerm2; `fleet-launch --go`, `fleet-conduct`)
- 🧠 **Think-loop (vO22):** 10 kanıtlı-çözüm registry · problem→proven|NEEDS_RESEARCH (no-guess) — `PROBLEM_REGISTRY.json`/`THINK.md` (autopilot sürekli çağırır)
- ⏭️ **Next-task (vO24):** 2 safe-additive (P1) · 26 kuyrukta — `FLEET_NEXT.md` (`/fleet-next`; worker'lar `## Next:` precompute eder)

## Şu anki ollamas aşaması (canlı — her lane shipped → geliştirilebilir)
| Lane | Şu an (shipped) | → Geliştirilebilir sonraki | dirty |
|------|-----------------|----------------------------|-------|
| `chore/p1-hardening` | P4 Migration drift fix — migrations.t… | → — | 77△ |
| `colab-gpu` | P4 Migration drift fix — migrations.t… | → — | 13△ |
| `fix/audit-security` | P4 Migration drift fix — migrations.t… | → — | 3△ |
| `verify/gwv2-all-lanes` | P4 Migration drift fix — migrations.t… | → — | 0△ |
| `fix/binary-architecture-calibration` | P4 Migration drift fix — migrations.t… | → — | 12△ |
| `fix/audit-cont` | P4 Migration drift fix — migrations.t… | → — | 1△ |
| `claude/cool-cohen-b245ee` | P4 Migration drift fix — migrations.t… | → — | 1△ |
| `(detached)` | P4 Migration drift fix — migrations.t… | → — | 0△ |
| `claude/loving-varahamihira-77d4a9` | ✅ Faz 12 v1.3 (Postgres + async store… | → — | 1△ |
| `claude/naughty-kowalevski-2ccc35` | ✅ Faz 12 v1.3 (Postgres + async store… | → — | 566△ |
| `(detached)` | P4 Migration drift fix — migrations.t… | → — | 0△ |

## Geliştirilebilir aşamalar (ROADMAP planned)
- (ROADMAP'te planned vO yok)

### Lane bazında geliştirilebilir sonraki (canlı NEXT sinyalleri)
- (lane NEXT sinyali okunamadı)

## Araç envanteri (38 bin/)
- `adopt-gate.ts` — adopt-gate.ts — vO4 OSS Adoption License-Discipline Gate
- `adopt.ts` — OSS adoption tracker + lisans-disiplini GATE
- `autofix.ts` — Self-healing remediation
- `autopilot.ts` — vO-AUTO 0-manuel orkestrasyon tetikleyici.
- `backlog.ts` — vO15 cross-lane CRITICAL backlog delivery
- `bench.ts` — Benchmark agregasyon raporu
- `benchprompt.ts` — FÜZYON: 0-manuel optimal model+config → TEK portable prompt
- `claim.ts` — vO7 Work-Claim CLI: bir sekme bir görevi
- `conduct.ts` — Zero-touch autonomous conductor
- `council.ts` — Hibrit model-council: yetenek-eşlemeli 18-model fleet ollamas'ı
- `critic.ts` — Self-auditing completeness critic
- `depgraph.ts` — Cross-lane bağımlılık grafiği + API-gap raporu
- `discover.ts` — READ-ONLY canlı keşif: çalışan dev-server'ları cwd ile
- `dispatchbench.ts` — vO18 Distributed-Dispatch research→test→update harness
- `dispatchdoctor.ts` — vO21 Fleet dispatch readiness doctor CLI
- `dispatchsim.ts` — vO20 Dispatch flow simulator CLI
- `doctor.ts` — vO-AUTO.1 readiness doctor
- `dod.ts` — Definition-of-Done + Concurrent-Task detector
- `driftguard.ts` — vO8 Drift-Guard CLI: deterministik tutarlılık GATE
- `fleet-agent.ts` — a PERSISTENT, living per-tab worker
- `fleet-conduct.ts` — the CONDUCTOR side of the local model-fleet.
- `fleet-launch.ts` — open the local model-fleet across Terminal.app + iTerm2.
- `fleet-next.ts` — compute the prioritized NEXT-TASK queue after a fleet round.
- `fleet-watch.ts` — LIVE follow-along console for the model-fleet
- `fuse.ts` — Unified Critical Requirements
- `heartbeat.ts` — Otonom sürdürülebilir tick
- `horizon.ts` — vO12 Roadmap Horizon Auto-Generator CLI
- `model-hook.ts` — UserPromptSubmit hook wrapper
- `oracle-serve.ts` — kalıcı Doğruluk Oracle daemon'u.
- `oracle.ts` — Doğruluk Oracle'ı CLI.
- `panel.ts` — panel.ts — vO4 panel "Tech-Lead orchestrator"
- `plan-next.ts` — Trigger §4 otomasyonu: "sıradaki versiyonu planla [lane]".
- `quality.ts` — vO9 Quality-Gate Roll-Up: 0-manuel tüm-lane sağlık matrisi.
- `reconcile.ts` — vO23 Autonomous Fleet Reconcile CLI + continuous loop.
- `scan.ts` — scan.ts — vO4 panel "parallel review" fazı: persona-başı DETERMİNİSTİK
- `serve.ts` — serve.ts — vO3 canlı cockpit sunucusu. ZERO-DEP
- `status.ts` — ollamas lane'lerinin READ-ONLY birleşik durum matrisi.
- `think.ts` — the THINK loop CLI

## Tetik
**"sıradaki versiyonu planla [lane]"** → kesintisiz plan+prompt (READ→CROSS-THINK→EMIT). Sözleşme: `ORCHESTRATION_AGENTS.md` + `~/Desktop/plan.md`.
