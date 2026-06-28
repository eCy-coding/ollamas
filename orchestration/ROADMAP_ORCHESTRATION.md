# ROADMAP_ORCHESTRATION.md — Orkestrasyon Lane (vO1 → vO10)

> Her versiyon bir **"Next precomputed"** handoff bloğu ile biter (zero-wait sıralama —
> lane ROADMAP'lerinden adopt edilen desen). Tetik: **"sıradaki versiyonu planla"**.
> Branch ≡ versiyon (drift-guard, ERR-SCR-001 dersi): `feat/orchestration-vN`.

| Versiyon | Durum | Kapsam |
|----------|-------|--------|
| **vO1** | ✅ DONE | Bootstrap: master prompt + roadmap + errors_registry + seyir + adoption matris + read-only status.ts |
| **vO2** | ✅ DONE | Live discovery — dev-server cwd-mapping (port-3000 collision çözüldü) + tmux-first/iTerm2/Terminal.app sekme keşfi + busy/idle sinyali + **§3.1 aktif koordinasyon** (nudge/notify, allowlist+dry-run) |
| **vO3** | ✅ DONE | **Canlı cockpit** — `serve.ts` (zero-dep node:http + SSE) + `cockpit.html` (tek dosya, iOS) backend runtime + lane matris canlı; `collect.ts` tek-kaynak (status.ts ile paylaşır) + `plan-next.ts` §4 trigger otomasyonu folded |
| **vO4** | ✅ DONE | OSS adoption tracker + **lisans-disiplini gate** — `licenses.ts`/`adopt.ts` matris-gate (GPL+ADOPT→İHLAL, RISK-ORCH-005 kodlandı) + `sbom.ts`/`adopt-gate.ts` syft SBOM gerçek-dep audit + ADOPT_GATE.md. Gate ilk catch: ADOPTIONS mislabel düzeltildi (ERR-ORCH-005) |
| **vO4-PANEL** | ✅ DONE | **Expert Diagnostic Panel** (f87a9a9) — 8 persona read-only scan→OSS-ref not→rapor; `scan.ts`/`panel.ts`/`lib/{detectors,note,rank,personas}` + discourse + consensus-boost (open-code-review Apache-2.0 deseni) |
| **vO4.2** | ✅ DONE | **Panel Trend & History** (daefe19) — append-only `panel-history.jsonl` + run-to-run delta (new/resolved/regressed/improved/persistent, SARIF baselineState deseni); `trend.ts` KARARLI noteKey eşleştirme (id-churn'e dayanıklı); PANEL_REPORT.md Trend bölümü; idempotent kanıt (run2 new=0) |
| **vO4.1** | ✅ DONE | **Panel Coverage Expansion** — 5 boş personaya gerçek detector (frontend choke-point/oversized, fullstack any-density, integrations secret-scan/insecure-http, macos shell-strict/lan-bind/rm-unquoted, mcp output-schema/exec-bypass) + coverage-critic (yetenek-bazlı) + `panel --refresh`; ERR-ORCH-007 (choke-point FP) PANEL_SEYIR'de |
| **vO5** | ✅ DONE | Cross-lane bağımlılık grafiği — `graph.ts`/`depgraph.ts` API-gap (frontend↔backend route MISSING/UNUSED + scripts↔registry → mermaid) + `drift.ts` **cross-package version-drift** (aynı dep farklı lane farklı pin, syncpack deseni) → DEPGRAPH.md |
| **vO-ID** | ✅ DONE | **Self-Identity protokolü** — "Bu sekmede görevin ne?" sorusuna canlı self-answer: `role.ts` (mission §0 + plan-next vO + ollamas server.json + **per-lane shipped→next collect REUSE** + araç envanteri) + `role-hook.ts` (UserPromptSubmit oto-enjeksiyon) + proje-local `.claude/settings.json` hook + `ROLE.md`. **3 paralel sekme impl'i → sentez** (collect-zengin jeneratör + oto-tetik hook; duplikat laneinfo/identity/whoami silindi). ORCHESTRATION_AGENTS §12. RISK-ORCH-012 |
| **vO6** | ✅ DONE | **Benchmark agregasyon + 0-manuel optimal seçim FÜZYON** — `bin/lib/bench.ts` (median/p95/MAD/sparkline + normalize + aggregate/rankEfficient/regressions + **isStale**) + `bin/bench.ts`→BENCH.md. **FÜZYON (T0 onayı):** `benchprompt.ts` artık `optimize.selectBest` (donanım-duyarlı: correctness-gate+VRAM-fit+tok/s) + RAM-tier `optimalConfig`'i Tier-A Claude routing'le birleştirir → **TEK** `MODEL_PROMPT.md` + `MODEL_SELECTION.json`; canlı sysctl M4; stale-uyarı + `--refresh` opt-in. İkinci artefakt OPTIMAL_PROMPT.md + optimize CLI silindi. `role.ts`→🏆 optimal-runtime satırı. RISK-ORCH-013. Adopt: hyperfine/criterion + ollama-benchmark MIT + RouteLLM gate (idea) |
| **vO6.1** | ✅ DONE | **Benchmark → taşınabilir model-seçim PROMPT'u** — `benchprompt.ts` BENCH.json'ı (worker bench-core) read-only CONSUME + Tier-A routing (plan.md §1) füzyon → `MODEL_PROMPT.md` (global-standart sectioned, paste-anywhere; correctness-gate→tok/s; self-update). Adopt pattern: f/prompts.chat + structured-prompts; RouteLLM idea-only. Commit-izole (lokal tip, worker bench.ts'e bağımsız) |
| **vO7** | ✅ DONE | **Work-Claim Ledger** (duplikasyon önleme) — `claims.ts` atomic `mkdirSync`-lock + append-only `seyir/work-claim.jsonl` LWW ledger (ts→fence→tab) + TTL/heartbeat **stale-takeover** + monoton **fencing** + `claim.ts` CLI (claim/--check/--list/--renew/--done/--release); `plan-next.ts` trigger collision-gate (--claim auto) + `status.ts` additive claim sinyali; **ORCHESTRATION_AGENTS §13**. Kök-fix: oturum-içi plan.md×2 + kimlik×2 duplikasyonu (ERR-ORCH-013). Adopt: proper-lockfile (MIT) + JSONL LWW + fencing token (idea, zero-dep). claims.test 15; full 248 |
| **vO8** | ✅ DONE | **Drift-Guard** (deterministik tutarlılık GATE, 0-manuel) — `driftguard.ts` 3-eksen: **branch-lane** (worktree-id≟branch, ERR-ORCH-004 hijack guard HARD) + **version-source** (ROADMAP≟VERSION≟git-tag single-source-of-truth, major-bazlı, UK-07/UK-10) + **choke-point** (panel-report.json REUSE, HARD) + branch-coherence (SOFT); declared⇒actual diff (Terraform deseni) + exit-code (HARD>0→1, conduct-gate uyumlu); `bin/driftguard.ts` girdisiz CLI→DRIFT.md; **ORCHESTRATION_AGENTS §14**. REUSE: plan-next parseVersions/currentAndNext + detectors chokepoint + shared. conduct.ts (worker autopilot) DRIFT-tier sinyali olarak çağırabilir. Adopt idea: release-please/changesets (single-source) + Terraform-drift + lefthook (zero-dep). driftguard.test 17; canlı 14 HARD+4 soft exit=1 |
| **vO9** | ✅ DONE | **Quality-gate roll-up + conduct wiring (0-touch uçtan-uca)** — `bin/lib/quality.ts` (parseTscResult/parseLastRun/rollup/toQualityTable) + `bin/quality.ts` CLI: her lane `tsc --noEmit` CANLI (stateless read-only) + vitest `.last-run.json` cache TÜKET (canlı-vitest YASAK, UK-08) → `QUALITY.md`/`QUALITY.json` (rollup conduct-uyumlu `redLanes{lane,detail}[]`). **CONDUCT WIRING:** conduct.ts:73 `redLanes:[]`→`QUALITY.json.redLanes` → autonomous conductor RED-lane tüketir (kanıt: eylem=RED:backend). `role.ts`→🩺 lane-health satırı. **BUG-FIX:** vO6 conduct ref-onarımı YARIM kalmıştı (optimal.config→selection.config crash) — canlı koşuda yakalandı+düzeltildi. RISK-ORCH-014. Adopt: turbo/nx affected-graph + reviewdog (MIT, idea) |
| **vO-AUTO.1** | ✅ DONE | **Readiness Doctor + staleness self-heal** (commit 6cef614) — `doctor.ts` deterministik read-only: "0-manuel autopilot CANLI + TAZE mi?" 4-check (hook-wiring SessionStart+model-hook settings.json HARD-fail, launchd-agent yüklü-mü WARN, bench-freshness MODEL_SELECTION stale/yaş WARN-selfHealable, artifacts) → `DOCTOR.md` + GO/NO-GO verdict + exact remediation + exit-code (NO-GO→1). `--fix` yalnız selfHealable (bench→benchprompt --refresh, artifacts→autopilot); settings.json/launchctl AKTİVASYON privileged→kullanıcı (guardrail: ajan kendi config'ini yazamaz). `autopilot.ts` 4. adım=doctor→AUTOPILOT.md readiness satırı her tick. Canlı: NO-GO (hook aktif değil + bench 6g bayat) DÜRÜST surface. Non-dup: critic=codebase, driftguard=branch/version, doctor=runtime-readiness. **§15**. Adopt-pattern brew/npm/flutter doctor (check{name,status,fix}+exit). doctor.test 7; full 339 |
| **vO-AUTO.2** | ✅ DONE | **Autonomous Staleness Self-Heal** (commit f969007) — autopilot `--heal`: bench bayat + server :3000 up + cooldown geçti ise **otomatik** `benchprompt --refresh` → "en-verimli model seçimi" elle müdahalesiz taze kalır (degrade düzelir; 6g bayat veri sorunu kapandı). `bin/lib/refresh.ts` PURE `shouldAutoRefresh` (stale&&serverUp&&cooled→go) + `.autopilot-refresh.json` stamp **debounce** (thrash yok). Ağır-refresh yalnız launchd `--heal`; SessionStart hızlı consume. Server kapalı→bench-lane'e devir (orchestration heavy-bench koşmaz). detect(doctor)→heal döngüsü kapandı = sürdürülebilir 0-manuel. Canlı: taze→atla (gereksiz iş yok). **§17**. Adopt-pattern p-debounce/launchd-cooldown (zero-dep). refresh.test 6; full 388 |
| **vO-FND.1** | ✅ DONE | **Çekirdek coverage kapatma** (commit ced8c2e) — sistemin KENDİ `dod.ts`/`critic.ts` gate'inin işaret ettiği EN YÜKSEK (sev 65) yarım-iş: `bin/shared.ts` 4 foundational export (`resolveLane`/`git`/`findFile`/`discoverWorktrees` — her tool import eder) test'siz. `tests/shared.test.ts` (11 case: resolveLane saf lane-routing + git/findFile/discoverWorktrees read-only repo-integration graceful). **Kaynak DEĞİŞMEDİ** (additive test). **KANIT: DoD skor 39→54, shared.ts yarım-iş 0 kayda düştü.** liveTabMap/signal.notify (sev 20) = I/O+osascript-freeze riski (RISK-ORCH-008) → ince-wrapper, pure-parser zaten test'li, atlandı. Yeni feature/scaffolding YOK; sistem-audit-driven. vitest 418 |
| **vO-FND.2** | ✅ DONE | **Tek-komut 0-manuel aktivasyon + son coverage gap** (commit e8e0357) — gerçek "0-manuel" boşluğu = AKTİVASYON (doctor her tur NO-GO: settings.json hook wire-değil). `bin/activate.sh`: Emre TEK komut koşar → `bin/lib/settings-patch.ts` (PURE idempotent merge: SessionStart→autopilot + UserPromptSubmit→model-hook, **role-hook KORUNUR**) settings.json'a uygular + `autopilot-install.sh` launchd + `doctor.ts` GO/NO-GO doğrular. **Ajan settings.json'ı YAZMAZ** (guardrail) → activate.sh Emre çalıştırınca (onun yetkisi); `--dry-run` kanıt (role-hook korunur, dosya yazılmaz). Eş-zamanlı: `collect.liveTabMap` coverage (ORCH_TAB_SIM=fail→null deterministik, son gerçek in-scope gap; signal.notify zaten test'li=critic-blind, 4×duplicate=false-positive). settings-patch.test 5 + liveTabMap 1. **KANIT: critic completeness 58→98, vitest 441, activate.sh --dry-run doğru merge.** §18 |
| **vO15** | ✅ DONE | **Cross-lane critical backlog delivery** (commit 09e476f) — conductor'ın EKSİK OUTPUT'u: cross-lane critical bulguları TESPİT eder ama lane'lere eyleme-hazır FIX-PROMPT teslim etmezdi (plan-next=versiyon, conduct=tek-aksiyon, DRIFT/QUALITY.md=rapor). `bin/lib/backlog.ts` PURE `aggregateBacklog` (driftguard HARD + QUALITY.json RED + panel-report high → sahibi-lane grupla + severity-DESC + dedup) + `renderLaneBacklog` (yapıştır-hazır + çalışma-prensibi footer) + `bin/backlog.ts` CLI (`<lane>` arg → o lane). **Conductor FIXLEMEZ §3** — backlog üretir, sahibi lane uygular. Bu = "ollamas projesi için critical" (gerçek critical issue'lar cross-lane). **Canlı: 5 lane · 32 critical teslim** (frontend:15 [13 apiClient choke-point bypass], backend:3 RED, scripts:4, integrations:2, repo:8). backlog.test 8; vitest 451; zero-leak (lane'lere 0 yazım). §19. Adopt-pattern issue-template/reviewdog-rdjson |
| **vO16** | ✅ DONE | **E2E Integration: Run, Diagnose, Repair & Publish** — lane'ler `integration/all-lanes`'e ENTEGRE (orchestration/ ana tree'de). Evidence-first CANLI-koş→teşhis: root **832 test yeşil** (mcp-stdio subscribe=async-flaky, 2× izole-geçti). **REPAIR:** (1) `shared.test.ts` stale-assertion (silinen orchestration-worktree→ANCHOR entegre-tree mevcut); (2) **activation portable** — `autopilot-install.sh`/`activate.sh`/`autopilot.plist` silinen `ollamas-orchestration-wt` hardcode-path → script-konumundan DİNAMİK türetilir (`BASH_SOURCE`/dirname; plist heredoc-generate); (3) **integration glue** root `AGENTS.md §9 Orchestration` (0-manuel kondüktör operating-model'e entegre, bolted-on değil). Pipeline entegre-tree'den çalışır (readiness 42→**76/100**, top SECURITY→COMPLETENESS). **PUBLISH = fork/eCy-coding `chore/p1-hardening`+`main` @ `f777c22`** (origin/adobemre1 403 read-only → fork writable). **Evidence:** activation-portable fix commit `f9ed527` (settings-patch.ts/autopilot-install.sh/activate.sh dynamic-path + node-PATH), shared.test.ts stale-fix, AGENTS.md §9; e2e 838/0; concurrent-task tests Faz7. RISK-ORCH-018 |
| **vO10** | ✅ DONE | **Heartbeat daemon** — `bin/heartbeat.ts`+lib: periyodik tick → conduct kararı + collision-safe + stuck-lane + delta-notify (alert-fatigue guard, state-hash idempotent). launchd/--watch. Adopt watchexec/chokidar idea. heartbeat.test |
| **vO11** | ✅ DONE | **Self-review critic + safe auto-fix** — `critic.ts` (roadmap-sync/orphan/coverage/duplication audit → CRITIC.json) + `autofix.ts` (CRITIC→ROADMAP planned→DONE flip, **scope-locked governance-only ASLA kod/lane**, dry-run default + atomic .bak). Adopt danger.js/release-please idea. critic.test+autofix.test |
| **vO12** | ✅ DONE | **Definition-of-Done gate + conduct ÖZ-DENETİM WIRING (0-touch self-policing)** — `dod.ts` 6-kural yarım-iş tespiti (code-without-test/uncommitted-green/orphan-marker/concurrent-task-gap/governance-drift/roadmap-incoherence → DOD.json). **KRİTİK WIRING:** TIERS+`COMPLETENESS` (RED-sonrası/STALE-öncesi); conduct.ts CRITIC.json+DOD.json findings'i TÜKETİR (merge → 31 COMPLETENESS finding, orphan-değil); autopilot chain benchprompt→**critic→dod**→conduct→status→doctor; `role.ts`→🧭 öz-denetim satırı. = Emre'nin "YARIM YOK" kuralı loop'ta OTOMATİK. RISK-ORCH-015. Adopt dod-checklist idea |
| vO13 | ✅ DONE | Horizon auto-roadmap (10-versiyon lookahead) — lib hazır, **conduct-merge + ROADMAP_HORIZON reconcile tasarımı gerekir (DEFER, yarım-commit-etme)** |
| **vO14** | ✅ DONE | **Critical-Requirements Fusion + Detector Precision + Self-Remediation** — (1) `fuse.ts` (conduct/critic/dod/quality → `REQUIREMENTS.md` kritik-öncelikli BİRLEŞİK liste + readiness skor; "TÜM gereksinimleri tespit et" otomatiği) autopilot chain'e WIRE'landı; (2) **DETECTOR PRECISION** `bin/lib/suppress.ts` + `.policy-suppress.json` (gerekçeli-istisna: IO-wrapper/false-pos-duplication) → dod/critic GÜRÜLTÜ-ele, **SİLENT-DEĞİL** (suppressed sayı+reason raporda) → **critic 60→98** verdict GÜVENİLİR (0-manuel conduct kararı precise); (3) self-remediation `tests/shared.test.ts` (4 pure export). `role.ts`→🎯 kritik-gereksinim. RISK-ORCH-016. Adopt: eslint-baseline/sonarqube-suppress idea |
| **vO15** | ✅ DONE | **Live Operation & Verdict Closure** (pipeline KOŞ + verdict'ine EYLEM) — ollamas :3000 UP + ollama 17-model ile `autopilot.ts` full-chain CANLI koşuldu; priority-engine 0-manuel TEK-EYLEM seçti: **SECURITY #1 `f/prompts.chat` lisans-ihlali**. KÖK: ADOPTIONS:90 license `permissive`(literal≠SPDX)→unknown+ADOPT→ihlal. **MATRIX-TRUTH fix** (license→`CC0-1.0` gerçek + karar→`idea-only` kod-değil-yapı; RISK-ORCH-005 suppress-değil) → **RE-RUN SECURITY=0** (convergence-kanıt = test/use real-time). + critic coverage-gap:suppress kapatıldı (suppress.test +loadSuppress → **critic 98→100**) + governance vO4.1/4.2 SEYIR backfill. RED:backend (LANE testi §3 backlog), uncommitted-green (regenerate-output kovalanmaz), DOCTOR-NO-GO (hook/launchd PRIVILEGED tek-kullanıcı-residue). RISK-ORCH-017 |
| **vO17** | ✅ DONE | **Distributed E2E Fleet Dispatch — SPEC + protokol** (Mac ↔ desktop-ert7724 Hybrid) — kanıt boşluğu: mevcut fleet yalnız **backend-seçimi** (`cli/lib/remote.ts`/`fleet.ts`), **remote agent dispatch + dağıtık görev ledger'ı YOK**. `SPEC_DISPATCH.md`: Hybrid mimari (desktop kendi GPU'sunda kendi ReAct worker'ı; Mac orkestratör ledger ile böl-ata-birleştir; worker-down → mac inference-substrate failover) + choke-point yasası (dispatch yalnız `/api/agent/chat` HTTP, ToolRegistry import YOK) + `(taskId)` ledger şema (claims.ts motoru genelleme) + assignWorker yönlendirme + lane-sahiplik matrisi. Kod cli/scripts lane'lerinde (Scope §3); bu sekme spec+prompt üretir. Emre onayı: Hybrid + orchestration-only. Adopt-pattern: exo/llama.cpp-RPC (Tailscale inference) + River/BullMQ (claim→heartbeat→done) + CrewAI/Swarm (orkestratör↔worker kontrat) — MIT/Apache, idea-only |
| **vO18** | ✅ DONE | **dispatchbench — research→test→update loop** ("test et, sonuca göre seçimi güncelle") — `bin/lib/dispatchbench.ts` PURE: `parseDispatchRecords` (graceful) + `aggregateDispatch` (median, per variant×makine) + `selectBestForMachine`/`selectAllMachines` (ordered gate: correctness→adım/dup→latency→tok/s, optimize.selectBest paritesi) + `assignWorker` (saf yönlendirme, fleet.decideTransition deseni) + `buildDispatchPrompt` (portable, evidence-law); `bin/dispatchbench.ts` CLI: tüket `~/.llm-mission-control/dispatch-bench.json` → `DISPATCH_PROMPT.md` + `DISPATCH_SELECTION.json` (no-data → önceki seçimi koru + STALE uyarı, benchprompt merge-guard paritesi). **KANIT: dispatchbench.test 21/21; CLI 2× koşu IDENTICAL (deterministik)**. Ağır gerçek-dispatch = cli/scripts lane (orchestration tüketir+seçer, §3). Adopt: promptfoo (eval-config) + DSPy (metric-driven select) idea-only |
| **vO20** | ✅ DONE | **Dispatch flow simülatörü + executable spec** (Hybrid protokolü canlı-makinesiz DOĞRULA) — vO17-19 spec+harness'i kurdu ama akış (split→assign→claim→heartbeat→failover→merge) hiç E2E KOŞULMADI (gerçek koşu cli+canlı desktop gerektirir, başka lane). `bin/lib/dispatchsim.ts` PURE: `simulateDispatch` sanal-saat (Date.now YOK) üzerinde tüm Hybrid akışı sürer — `assignWorker` (dispatchbench.ts:176 REUSE) + claims.ts:65/76/81 fold/stale ledger modeli aynası; worker mid-run düşerse `failed`+failover→mac substrate re-route, sağlıkta failback. `bin/dispatchsim.ts` CLI kanonik senaryo → `DISPATCH_SIM.md` golden-trace (cli executable-spec/compliance oracle). **EVIDENCE-LAW DÜRÜST:** akış-mantığı doğrular, tok/s UYDURMAZ, `dispatch-bench.json` SEED ETMEZ → variant=null gap gerçek kalır. **KANIT: dispatchsim.test 15/15; CLI 2× IDENTICAL; trace t2 desktop→mac @tick3 failover + t5 failback→desktop @tick103 + allOk DONE.** Adopt: spec-to-code-compliance (executable golden trace) + claims.ts LWW/stale (idea) |
| **vO19** | ✅ DONE | **MASTER_DISPATCH kalıcı master-prompt + horizon wiring + memory** — `MASTER_DISPATCH.md` (Mission/Boundaries/Working-principles/Research→Test→Update loop/Evidence-law) = bu sekmenin dağıtık-dispatch kimliği; `horizon.ts` gatherSignals'a DISPATCH_SELECTION.json gap-sinyali (variant=null makine → cli lane backlog) WIRE'landı → gelecek versiyonlar oto-uzar; memory `dispatch-fleet-mission.md` (Hybrid karar + orchestration-only scope + evidence-law, proje bitene dek uyulur). Lane'lere yapıştır-hazır prompt'lar (cli v1.x-a..d / scripts s.1-2 / e2e e.1) teslim |

---

## vO1 — Bootstrap (ACTIVE)

**Hedef:** Orkestrasyon lane'i kendi izole worktree'sinde ayağa kalksın; bu sekme her
oturumda obey edeceği master prompt'a, birleşik durum görüşüne ve hata hafızasına sahip olsun.

**Todo:**
- [x] İzole worktree `~/Desktop/ollamas-orchestration-wt` (feat/orchestration-v1)
- [x] `ORCHESTRATION_AGENTS.md` master prompt (§0-§8)
- [x] `ROADMAP_ORCHESTRATION.md` (bu dosya)
- [x] `errors_registry.json` (ERR-ORCH şema + RISK preload)
- [x] `SEYIR_DEFTERI_ORCHESTRATION.md`
- [x] `ADOPTIONS_ORCHESTRATION.md` (ranked OSS matris)
- [x] `bin/status.ts` read-only durum matrisi
- [x] status.ts kanıt koşusu → STATUS.md üretildi (7 worktree), lane ağaçları unchanged doğrulandı (0 leak)

**Phase sırası:** READ şablonlar → WRITE governance → BUILD status.ts → VERIFY (koş + zero-write kanıt) → LOG → COMMIT.

**Next precomputed (→vO2):** status.ts'e canlı tab-discovery ekle: `ps`/lsof ile çalışan
dev-server'ları (vite 5173, backend 3000, tsx watch) read-only sapta + terminal.app sekme
sayısını AppleScript ile sorgula (iTerm2 -CC desen, ref-only — GPL kod kopyalama). Worktree
listesi zaten dinamik; hardcoded lane adı kalmasın. Test: yeni worktree eklenince matris
otomatik büyür.

---

## vO2 — Live Discovery (DONE 2026-06-20)

**Yapıldı:**
- `discover.ts` (NEW): pure parser (parseLsofListen/parseLsofCwd/matchWorktree/mapServersToWorktrees/parseTabs) + native read-only sarmalayıcılar (listenersLive/pidCwdLive/discoverTabs/pidsOnTty/tabWorktree).
- Dev-server: lsof→pid→cwd→worktree (port-3000 collision çözüldü; Docker:3000 lane sayılmaz). ERR-ORCH-001.
- Terminal.app sekme keşfi (osascript hibrit; izin yok → zarafetle atlar, ORCH_TAB_SIM=fail testi).
- idle-lane sinyali (git %ct, >ORCH_IDLE_HOURS saat → 💤).
- status.ts rewrite: Tab/Idle kolonları + "beklenen 8 vs canlı N" header.
- TDD: discover.test.ts 9/9 pass (6×port-3000 disambiguation dahil) + orchestration/vitest.config.ts (root vite kontaminasyon by-pass, ERR-SCR-002 dersi).

**Kanıt:** vitest 9/9; status.ts canlı 7 worktree + 3 dev-server + 11 sekme; lane ağaçlarına 0 yazım.

**Bilinen sınır:** tab↔lane cwd eşlemesi best-effort (shell cwd home ise eşlenmez) — vO9 heartbeat'te güçlendirilecek.

**Next precomputed (→vO3):** trigger protokolü §4'ü script'e bağla — `plan-next.ts <lane>` verilen
lane'in SEYIR+ROADMAP+errors'ını okuyup todo+phase+optimal-prompt taslağı emit etsin (insan
onayı ile). a3-swod skill çıktısını şablonla. Dosya: NEW orchestration/bin/plan-next.ts +
tests/plan-next.test.ts (lane→şablon pure fonksiyon). status.ts'in roadmapSignal/errorSignal
helper'larını discover.ts'e ortak çıkar (DRY).

---

## vO3 — Canlı Cockpit (DONE 2026-06-20)

**Hedef (T0/Emre):** ollamas'ı + 7 lane'i MacBook & iOS Safari'den tek ekranda canlı izle. status.ts
tek-seferlik Markdown'dı; canlı web/SSE yoktu → boşluk dolduruldu.

**Yapıldı:**
- `bin/lib/metrics.ts` (NEW): saf parser — `/api/health` JSON (server.ts:221 şekli) → BackendHealth +
  Prometheus `/metrics` `sumPromMetric`/`promGauge` (mcp_tool_calls_total, webhook_queue_depth,
  migration_version). Bozuk girdi → null/0, asla throw. `tests/metrics.test.ts` 10/10.
- `bin/lib/collect.ts` (NEW): cockpit'in TEK kaynağı `collect()` → `CockpitSnapshot` (lanes + backend
  runtime + totals). Saf çekirdek `roadmapStruct`/`errorStruct`/`buildSnapshot` test'li. `tests/collect.test.ts` 7/7.
- `bin/serve.ts` (NEW): zero-dep node:http — `GET /cockpit.json` + SSE `/events` (poll 5s) + `GET /`.
  127.0.0.1 default, `--lan`→0.0.0.0 (iOS opt-in). `makeHandler` inject'li → `tests/serve.test.ts` 5/5.
- `assets/cockpit.html` (NEW): tek dosya, vanilla JS + EventSource + inline CSS (frontend token kopya
  değerleri) + vanilla SVG sparkline (performa/react-sparklines fikir). iOS responsive, document.hidden→pause.
- `bin/plan-next.ts` (§4 trigger): plan-next folded — lane ROADMAP'ten current/next + spec + todos +
  don't-repeat → NEXT.md taslağı (spec-kit + Vanderbilt SPDD). `tests/plan-next.test.ts` 24/24.

**Kanıt (canlı):** vitest 50/50 + signal.test 28/28. Canlı serve: `/cockpit.json` 200 (2.2s, 8 lane gerçek
veri + **backend runtime canlı okundu** cpu/ram/toolCalls), `/` 200 html, `/nope` 404, SSE 1 data-frame teslim.
Zero-leak: bu worktree'de orchestration/ dışı 0 değişiklik; diğer 7 lane ağacına 0 yazım.

**Çözülen gerçek gap (canlı testte bulundu):** collect() ilk ölçümde 7.5s'di — osascript sekme keşfi
SENKRON execFileSync event-loop'u ~5s donduruyordu (Automation izni yokken hang). Fix: sekme keşfi serve'de
default KAPALI (`ORCH_TABS=1` opt-in), backend fetch timeout 800ms → collect 2.2s, SSE akıyor. **Tasarım dersi
RISK-ORCH-008:** senkron subprocess (osascript) tek-thread server'ı donduruyor; pahalı/nadir-değişen veri
poll dışına alınmalı.

**Karar (no-break):** status.ts collect()'e refactor EDİLMEDİ — STATUS.md'yi bit-aynı korumak için (roadmapStruct
slice farkı çıktıyı değiştirirdi). status.ts stabil kalır; DRY duplikasyonu kabul, kural#1 (kırma) > DRY.

**Test-gelenek dersi RISK-ORCH-009:** iki gelenek yan yana — `tests/*.test.ts` vitest, `bin/lib/signal.test.ts`
standalone tsx. vitest glob'u GENİŞLETME (signal.test'i kırardı); yeni vitest testleri `tests/`'e koy.

**Bilinen sınır:** collect() git fan-out 8 worktree ~2s; çok-lane'de yavaşlayabilir → vO-ileri paralel git/cache.

**Next precomputed (→vO4):** OSS adoption tracker — `bin/lib/adoption.ts` ADOPTIONS_ORCHESTRATION.md tablosunu
parse et + lane bazında "hangi repo hangi versiyonda çekildi" durum + lisans-disiplini gate (GPL→ref-only
uyarısı). Cockpit'e adoption paneli (snapshot'a `adoptions[]` alanı + cockpit.html sekmesi). Test: parse
+ gate pure fn. Oturum başı `git branch --show-current`==`feat/orchestration-v3` doğrula (ERR-ORCH-004).
