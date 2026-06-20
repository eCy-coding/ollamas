# SEYIR DEFTERI — Orkestrasyon Lane

> Faz-faz anlatı günlüğü. Her versiyon: ne yapıldı, kanıt, hata (varsa → errors_registry).
> Format aynası: FRONTEND_SEYIR_DEFTERI.md.

---

## vO1 — Bootstrap (2026-06-20)

**Bağlam:** ollamas 6 izole worktree lane'e büyüdü (backend/MCP `feat/v1.7-mcp-adopt`,
cli `feat/cli-v2-clean`, frontend `feat/frontend-vf3`, integrations `feat/gateway-v2`,
scripts `feat/scripts-v1`, bench `feat/v1.8-bench`), ~8 terminal.app sekmesinde paralel
geliştiriliyor. Kondüktör yoktu. Bu lane onu kuruyor.

**Yapıldı:**
- İzole worktree `~/Desktop/ollamas-orchestration-wt` @ `feat/orchestration-v1` (base: main c19a0b6). Kanıt: `git worktree list | grep orchestration`.
- `ORCHESTRATION_AGENTS.md` master prompt: §0 north star, §1 canonical AGENTS.md'ye subordinasyon, §2 roller+/skill, §3 read-only scope law, §4 "sıradaki versiyonu planla" trigger protokolü, §5 token disiplini, §6 brain/memory/skills, §7 kalite kapısı, §8 logbook disiplini.
- `ROADMAP_ORCHESTRATION.md`: vO1→vO10, her biri "Next precomputed" handoff.
- `errors_registry.json`: ERR-ORCH şema + 6 RISK preload (branch-hijack, stale-drift, scope-creep, token, lisans, port-probe).
- `ADOPTIONS_ORCHESTRATION.md`: ranked OSS matris, lane'e map, lisans-flag.
- `bin/status.ts`: read-only birleşik durum matrisi (worktree auto-discover).

**Karar:** Saf koordinatör + izole worktree + read-only status script (T0 Emre onayı).

**Hata:** yok (bootstrap).

**Next precomputed (→vO2):** status.ts'e canlı tab/dev-server discovery + idle-lane sinyali.

---

## vO2 — Live Discovery (2026-06-20)

**Bağlam:** vO1 dev-server tespiti bozuktu. Keşif: 6 worktree de port 3000'e bind
(server.ts:31 `process.env.PORT || 3000`). Port ile lane ayırt edilemez (RISK-ORCH-006 gerçek).

**Yapıldı:**
- `bin/discover.ts` (NEW): read-only canlı keşif. Pure parser'lar (test edilebilir) + native
  lsof/ps/osascript sarmalayıcılar. Dev-server lsof→pid→**cwd**→worktree ile atanır (port DEĞİL).
- `bin/status.ts` rewrite: portFor/probe silindi; discover.ts entegre; **DevSrv** `:port(pid)`
  cwd-attributed, **Tab** (Terminal.app sekme/lane), **Idle** (💤 >3sa) kolonları + header
  "beklenen 8 vs canlı N sekme".
- `tests/discover.test.ts` (NEW): 9 case, 6×port-3000 cwd-disambiguation + Docker eleme.
- `vitest.config.ts` (NEW, orchestration-scoped): root vite.config @tailwindcss kontaminasyonu
  by-pass (ERR-SCR-002 dersi; plain-object, import yok).

**Kanıt:**
- `vitest run --config orchestration/vitest.config.ts` → 9/9 pass.
- `tsx orchestration/bin/status.ts` → 7 worktree, 3 dev-server (cli :61619 cwd-attributed,
  Docker:3000 lane sayılmadı), 11 canlı sekme. ORCH_TAB_SIM=fail → zarafetle "Sekme keşfi: skip".
- Lane ağaçlarına 0 yazım (scope law korundu).

**Hata:** ERR-ORCH-001 (port-3000 collision, fixed cwd-mapping), ERR-ORCH-002 (JSDoc `*/`
yorum-kapatma, fixed). İkisi de errors_registry'de.

**Drift:** branch `feat/orchestration-v1` hâlâ aktif (vO1+vO2 aynı v1 branch; versiyon bump
yapılmadı — orkestrasyon lane'i tek branch'te ilerliyor, drift-guard bunu kabul eder).

**Next precomputed (→vO3):** `plan-next.ts <lane>` — trigger protokolü §4 otomasyonu.

---

## vO2-merge — Aktif Koordinasyon + iTerm2/tmux fold (commit ↓, 2026-06-20)

**Bağlam:** vO2 İKİ sekme tarafından PARALEL kodlandı. Bu sekme bağımsız `lib/tabs.ts`+`lib/signal.ts`
yazdı; diğer sekme `discover.ts`+`status.ts`+vitest yazdı. T0 kararı: **MERGE (sıfır kayıp)** — diğerinin
discover/status matrisi KORUNDU, bu sekmenin koordinasyon katmanı + iTerm2/tmux ona fold'landı (`tabs.ts` silindi).

**Yapıldı (bu sekme):**
- `bin/lib/signal.ts` (NEW): §3.1 koordinasyon — `nudge` (allowlist `git status`+injection-guard, dry-run default,
  seyir audit) + `notify` (terminal-notifier MIT). `signal.test.ts` 28 case (tsx zero-dep).
- `bin/discover.ts` ENHANCE: `discoverTabs` artık **tmux-first → iTerm2 + Terminal.app** (önceden Terminal-only).
  `parseTmuxPanes` + `parseTabsTagged` + `isShellCmd` (busy/idle) eklendi. **ERR-ORCH-003 fix**: AppleScript
  `tab` sabiti app `tab` class'ı ile çakışıyor + string-literal `\t` gerçek-tab değil → ayraç `ASCII character 9`
  tell-bloğu dışında tanımlanır. (Diğer sekmenin `TAB_OSA`'sı bu canlı bug'ı taşıyordu; testleri JS-`\t` ile
  geçtiği için yakalamamıştı.) `tests/discover.test.ts` +4 describe (tmux/tagged/shell).
- `bin/status.ts` ENHANCE: `--nudge`/`--notify`/`--dry-run` flag + idle-lane koordinasyon bloğu (lane→temsilci-sekme).

**Kanıt:** vitest 13/13 + signal.test.ts 28/28. `tsx status.ts` canlı: 7 worktree, 12 sekme keşfi (tmux yok→
AppleScript fallback, iTerm2+Terminal). `--nudge --dry-run` → idle lane planı stdout (gönderim yok). Lane ağaçlarına 0 yazım.

**Hata/Drift (DÜZELTME):** Yukarıdaki "branch v1 aktif" notu ARTIK GEÇERSİZ — **ERR-ORCH-004 branch-hijack
gerçekleşti**: eşzamanlı sekme `git checkout feat/orchestration-v3` ile bu worktree'yi v1→v3'e kaydırdı
(reflog `HEAD@{0}: checkout: moving from feat/orchestration-v1 to feat/orchestration-v3`). HEAD base-main'de
kaldı = vO2 hiç commit edilmemişti. T0 kararı: green işi HEMEN **feat/orchestration-v3**'te lock-in
(branch=v3 / içerik=vO2-tamamlama drift'i kabul; hız > branch-saflığı). vO1+vO2 governance da ilk kez bu
commit'le kalıcılaştı (önceden tümü untracked'ti — memory "vO1 DONE" ile git uyuşmazlığı, RISK-ORCH-002).

**Next precomputed (→vO3):** `plan-next.ts <lane>` trigger §4 otomasyonu — verilen lane'in SEYIR+ROADMAP+errors
oku → todo+phase+optimal-prompt taslağı emit (a3-swod template, HIL onay). vO3'e başlamadan oturum-başı
`git branch --show-current`==`feat/orchestration-v3` doğrula (ERR-ORCH-004 prevention).

---

## vO3 — Canlı Cockpit (2026-06-20)

**Tetik (Emre/T0):** "cockpit inşa et — ollamas'ı MacBook+iOS'tan canlı izle, soru sormadan e2e tamamla."
Onaylı plan → cockpit = vO3 (plan-next §4 folded). Branch `feat/orchestration-v3` (oturum başı doğrulandı).

**Yapıldı (bu sekme):**
- `bin/lib/metrics.ts` + `tests/metrics.test.ts` (10/10): /api/health JSON + Prometheus /metrics saf parser.
- `bin/lib/collect.ts` + `tests/collect.test.ts` (7/7): cockpit TEK kaynak `collect()→CockpitSnapshot`; status.ts
  ile paylaşılabilir (refactor edilmedi — aşağı bak).
- `bin/serve.ts` + `tests/serve.test.ts` (5/5): zero-dep node:http /cockpit.json + SSE /events + /; --lan iOS.
- `assets/cockpit.html`: tek dosya vanilla JS + EventSource + inline CSS token kopya + SVG sparkline.
- `plan-next.ts` (önceden vardı, untracked) + `tests/plan-next.test.ts` (24/24): §4 trigger korundu.

**Kanıt (canlı, "passing'e zorla fix yok"):** vitest 50/50 + signal 28/28. Canlı serve port-probe: /cockpit.json
200 2.2s (8 lane + backend cpu/ram/toolCalls CANLI okundu), / 200 html, /nope 404, SSE 1 data-frame teslim.
Zero-leak: orchestration/ dışı 0 değişiklik (bu worktree) + 7 lane ağacına 0 yazım.

**RISK-ORCH-008 (canlı testte bulundu, kök-neden fix):** collect() ilk ölçüm 7.5s — osascript sekme keşfi
SENKRON execFileSync event-loop'u ~5s donduruyor (Automation izni yok→hang); cache bile server'ı dondurdu
çünkü senkron çağrı tek-thread'i bloke ediyor. FIX: sekme keşfi serve'de default KAPALI (`ORCH_TABS=1` opt-in)
+ backend fetch timeout 800ms → collect 2.2s, SSE akıyor. **Ders: pahalı/nadir-değişen senkron subprocess
poll-yolundan çıkar.**

**RISK-ORCH-009 (test-gelenek çakışması):** `tests/*.test.ts`=vitest, `bin/lib/signal.test.ts`=standalone tsx
(28/28, kendi ok()/process.exit). Plan'daki "vitest glob'u genişlet (P0)" YANLIŞTI — genişletmek signal.test'i
kırardı (vitest-stili değil). **Ders: yeni vitest testleri `tests/`'e koy, glob'a dokunma.**

**Karar (kural#1 kırma > DRY):** status.ts collect()'e refactor EDİLMEDİ; STATUS.md bit-aynı kalsın diye
(roadmapStruct slice farkı çıktıyı bozardı). DRY duplikasyon kabul; status.ts stabil+tested.

**ERR-ORCH-004 tekrarı (gözlem):** eşzamanlı sekme `d476a9d "vO2..."` commit'i bu oturumun cockpit dosyalarını
da süpürdü (working tree paylaşımlı). History rewrite YAPILMADI (tab aktif); governance bu commit'le vO3 olarak
işaretlendi. **Ders pekişti: cross-lane commit'te explicit `git add <path>`, branch doğrula.**

**Next precomputed (→vO4):** OSS adoption tracker — `bin/lib/adoption.ts` ADOPTIONS tablosunu parse + lane/versiyon
durum + lisans-disiplini gate (GPL→ref-only uyarı) → cockpit'e adoption paneli (snapshot.adoptions[] + html sekme).
Test: parse+gate pure fn. collect() git fan-out paralelleştir (2s→<1s). Oturum başı branch==v3 doğrula.

---

## vO4 — OSS Adoption Tracker + License-Discipline Gate (2026-06-20)

**Bağlam:** vO4 İKİ sekme PARALEL kodladı (vO2 deseni tekrar). Diğer sekme matris-gate çekirdeğini yazdı
(`bin/lib/licenses.ts` SPDX classify + `bin/adopt.ts` parseAdoptionRows/gate + `tests/adopt.test.ts`). Bu sekme
**additive katman** ekledi: gerçek-bağımlılık SBOM denetimi (onların kapsamında YOK). Çakışma=0 (ayrı dosyalar,
onların kontratını REUSE).

**Yapıldı (bu sekme):**
- `bin/lib/sbom.ts` (NEW): `parseSyftSbom` (anchore/syft Apache-2.0 `-o json` SBOM tüket, kod kopyalama yok) +
  `auditLaneDeps` (lane package.json runtime dep lisansını licenses.ts `classifyLicense` REUSE ile sınıfla;
  strong-copyleft runtime dep → flagged; SBOM yoksa unknown/flagged=false — pozitif kanıtsız suçlama yok).
- `bin/adopt-gate.ts` (NEW, CLI): İKİ katman — (1) ADOPTIONS matris gate (their `parseAdoptionRows`+`gate` REUSE,
  shared.ts `discoverWorktrees`/`findFile` REUSE) (2) `--sbom` syft per-worktree gerçek-dep audit → `ADOPT_GATE.md`
  rapor + exit-code (matris-ihlali=hard fail 1, copyleft-runtime-dep=soft uyarı).
- `tests/sbom.test.ts` (NEW, vitest): parseSyftSbom + auditLaneDeps 6 case.

**Kanıt (canlı):** vitest tüm suite + sbom 6 yeşil. `tsx adopt-gate.ts` → mevcut 34-satır ADOPTIONS doğrulandı.
**Gate'in ilk gerçek catch'i (ERR-ORCH-005):** ADOPTIONS satır-76 lisans hücresi 'GPL→native API' + ADOPT →
copyleft+kod-kopyalama görünümü → İHLAL exit 1. Gerçek: iTerm2 native scripting property'si (GPL kaynak değil).
Fix: hücre 'GPL→native API'→'native' (matrisi DÜRÜST yap, gate'i suppress etme). Yeniden: ✅ temiz exit 0.
syft kurulu değil → `--sbom` zarafetle atlar, matris-gate yine çalışır. Lane ağaçlarına 0 yazım.

**Research (e2e GitHub, top-star permissive):** anchore/syft (9.1K Apache, SBOM ADOPT), spdx/license-list-data
(CC0, classify DATA port), davglass/license-checker (1.7K MIT, dep-lisans deseni ref), sverweij/dependency-cruiser
(6.8K MIT, vO5 dep-graph), commitlint (18.6K MIT, vO7), reviewdog (9.4K MIT, vO8). GPL araç YOK.

**Next precomputed (→vO5):** Cross-lane bağımlılık grafiği — `dependency-cruiser --output json` (MIT) tüket →
lane↔lane import/API grafiği + cross-package version-drift (syncpack deseni). sbom.ts'in dep-parse'ı + adopt.ts'in
satır-parse'ı taban. Çıktı: cockpit'e dep-graph paneli + `DEPGRAPH.md`. Oturum başı branch==feat/orchestration-v3.

---

## vO5 — Cross-Lane Dependency Graph + Version-Drift (2026-06-20)

**Bağlam:** vO5 İKİ sekme PARALEL kodladı (yine MERGE deseni). Diğer sekme **API-gap** boyutunu yazdı
(`bin/lib/graph.ts` extractRoutes/extractCalls/extractRegistrations/gapAnalysis/toMermaid + `bin/depgraph.ts`
CLI: backend route ↔ frontend `/api` çağrı ↔ scripts registry → MISSING/UNUSED + mermaid → DEPGRAPH.md +
`tests/depgraph.test.ts`). Bu sekme **ikinci core boyutu** ekledi: cross-package **version-drift** (research'te
syncpack/manypkg üst-kategori, worker'ın graph.ts'inde YOK). Çakışma=0 (ayrı dosya + minimal additive section).

**Yapıldı (bu sekme):**
- `bin/lib/drift.ts` (NEW): `laneDepMap` (package.json deps+devDeps birleşik) + `detectVersionDrift` (dep'i
  isimle grupla, distinct range>1 → drifted; drifted-önce sıralı, syncpack single-version-policy) + `toDriftTable`.
- `tests/drift.test.ts` (NEW, vitest): 9 case (merge, drift tespiti, tek-lane no-drift, sıralama, tablo).
- `bin/depgraph.ts` ENHANCE (additive, worker dosyasına minimal): drift import + lane package.json tara +
  "## Cross-Package Version Drift" section DEPGRAPH.md'ye. shared.ts `discoverWorktrees`/`findFile` REUSE.

**Kanıt (canlı):** vO5 set vitest 16/16 (drift 9 + depgraph 7). `tsx depgraph.ts` → DEPGRAPH.md: API-gap (MISSING/
UNUSED/mermaid) + **"Version Drift (0 drifted / 8 lane)"** — git-worktree'ler aynı repo root package.json'ı
paylaşıyor → drift=0 BEKLENEN ve doğru (RISK-ORCH-011 notu). Lane ağaçlarına 0 yazım.

**Hata/Not:** Worker eşzamanlı `tests/detectors2.test.ts` (panel-v2 RED TDD, 33 fail — impl uyumsuz) yazıyor;
BENİM commit'ime DAHİL EDİLMEDİ (worker'ın in-flight RED işi). RISK-ORCH-011 (drift salt-string, semver-aware değil →
soft-warn sinyal).

**Research (e2e GitHub, top-star permissive):** syncpack 2.1K MIT (version-drift deseni), dependency-cruiser 6.7K
MIT (import-graph JSON, future), oasdiff 2.3K Apache (OpenAPI diff, future), mermaid 71K MIT (text DSL format).
renovate AGPL → idea-only (bundle yasak). GPL kod YOK.

**Next precomputed (→vO6):** Benchmark aggregation — bench lane (`feat/v1.8-bench`) tok/s metriklerini topla
(MacBook + iOS); `MinhNgyuen/llm-benchmark` MIT + Rapid-MLX/mlx-lm Apple-Silicon baseline (scripts lane v4 zaten
adopt etti — onların bench-metrics.mjs çıktısını TÜKET, yeniden hesaplama). Cockpit'e bench paneli + BENCH.md.
collect.ts'e bench alanı. Oturum başı branch==feat/orchestration-v3.

---

## vO-ID — Self-Identity Protokolü (DONE 2026-06-20)

**Hedef (T0/Emre):** "Bu sekmede görevin nedir? Ne yaparsın?" sorusuna **kalıcı + daima-geliştirilebilir
self-answer** — ollamas'ın O ANki aşamasını (her lane shipped→geliştirilebilir) + bu sekmenin rolünü canlı yansıt.

**Yapıldı (SENTEZ):** 3 paralel sekme aynı özelliği yazmıştı (whoami/rolecard + identity/laneinfo + role/role-hook),
hepsi untracked, suite RED (identity.test 1 fail). T0 onayıyla TEK temiz sentez:
- **Koru:** `role.ts` (mission §0 + plan-next vO doğru parser + ollamas server.json + araç envanteri) +
  `role-hook.ts` (UserPromptSubmit regex → `additionalContext` oto-enjeksiyon, eşleşmezse sessiz) +
  proje-local `.claude/settings.json` hook (yalnız bu worktree'de yüklenir = tek-sekme kapsamı) + `ROLE.md`.
- **Fold (benim katkı):** `collect()` REUSE → **per-lane canlı tablo** (her lane shipped→geliştirilebilir + dirty)
  + lane-bazlı NEXT sinyalleri. buildRoleAnswer'a additive, mevcut testler korundu.
- **Sil:** `identity.ts`/`lib/laneinfo.ts`/`identity.test.ts` (duplikat + kırık) + `whoami.ts`/`lib/rolecard.ts`/
  `whoami.test.ts` (redundant jeneratör — fikir role.ts'e fold edildi).

**Kanıt:** vitest **195/195** yeşil (role.test per-lane tablo + laneNext + boş-graceful eklendi).
Canlı `role.ts` → `[role] vO5→vO6, 8 lane, 10 araç` + ROLE.md per-lane tablo gerçek veri. Hook E2E:
rol-sorusu→tam cevap enjekte, alakasız prompt→sessiz exit 0. Self-update: governance ilerleyince yanıt
otomatik güncellenir (hardcode yok). Scope: yalnız orchestration/** + .claude; 8 lane ağacı 0 yazım.

**GOTCHA (RISK-ORCH-012):** marker-collision — statik prose'a literal `AUTO:BEGIN/END` yazmak splice regex'ini
yanılttı (ilk impl'imde); fix prose'dan literal marker çıkar. Per-lane string'leri roadmapStruct gürültülü
(cockpit ile aynı, dürüst-canlı); orchestration KENDİ current/next'i plan-next ile DOĞRU.

**Next precomputed (→vO6):** değişmedi — Benchmark aggregation (yukarı). role.ts genişletilebilir: bench tok/s
özeti, son commit, test sayısı gibi canlı sinyaller (§12 daima-geliştirilebilir).

## vO6.1 — Benchmark → Taşınabilir Model-Seçim PROMPT'u (2026-06-20)

**Ne:** Emre "benchmark sonucunu nereye yapıştırılırsa en-verimli seçimle çalışmaya başlayan kusursuz
global-standart prompt'a dönüştür" istedi. Worker vO6 bench-CORE'u (lib/bench.ts median/p95/MAD/regression +
bench.ts→BENCH.json) zaten kurmuş (UNTRACKED, GREEN); o **DATA** üretir, **prompt** üretmez → boşluk.

**Yapıldı:** `bin/lib/benchprompt.ts` (PURE `buildModelSelectionPrompt` — role/working_principles/runtime_evidence/
selection_rule/output sectioned, deterministik) + `bin/benchprompt.ts` (BENCH.json read-only CONSUME → MODEL_PROMPT.md
+ stdout, ts=mtime churn-free) + `tests/benchprompt.test.ts` (9 case). Tier-A routing plan.md §1 (Opus-plan/Sonnet-code/
Haiku-search) + Tier-B correctness-gate→tok/s füzyonu.

**Kanıt:** vitest 248/248 (benchprompt 9 dahil), signal 28/28. Canlı: champ `qwen3-coder:30b` 119.7 tok/s,
`qwen3:4b` 111 tok/s ama correct=0 → ✗ disqualified (correctness-gate çalışıyor). **Self-update kanıtı:**
BENCH.json champ→gpt-oss değiştir→prompt champ gpt-oss oldu→geri yüklendi. Zero-leak: 8 lane ağacına 0 yazım.

**Karar (commit-izolasyon):** benchprompt lib/bench.ts'e tip-import EDİYORDU → worker'ın untracked dosyası;
ben commit edip o commit'lenmezse temiz checkout kırılır → Agg/Regression tiplerini **lokal tanımladım**
(runtime'da BENCH.json düz-JSON, tip-only). Böylece commit'im self-contained, worker bench.ts'ten bağımsız.

**Adopt (vibe-yok):** f/prompts.chat (role→constraints→evidence→output yapısı, permissive) + gszhangwei/
structured-prompts (XML-section paste-anywhere, MIT) — desen-kopya. RouteLLM (Apache, ML-classifier) idea-only,
kod kopyası YOK. tok/s metodolojisi (LarHope/aidatatools MIT) zaten worker bench-core'da.

**Next precomputed (→vO7):** Drift-guard otomasyon (branch≡roadmap, choke-point bütünlüğü). benchprompt
genişletilebilir: per-task model (coding↔reasoning↔vision ayrı champ), iOS device kolonu (cli-bench.json target).

---

## vO6 — Benchmark Aggregation + 0-Manuel Optimal Seçim FÜZYON (2026-06-20)

**Tetik (Emre/T0):** "sıradaki versiyonu planla" + **0 manuel seçim/işlem** — bench verisinden M4+ollamas için
OTOMATİK en-iyi model+config (test-geçen, runtime+matematik+kod-bütünlüğü) → nereye yapıştırılırsa en-verimli
seçimle çalışan TEK portable prompt.

**Bağlam (4-worker proliferation):** bench.ts(istatistik) + optimize.ts(donanım-duyarlı selectBest+buildWorkingPrompt
→OPTIMAL_PROMPT.md) + benchprompt.ts(Tier-A routing→MODEL_PROMPT.md) + conduct.ts(vO8 zero-touch) — hepsi untracked,
İKİ portable-prompt artefaktı. optimize.test Explore-RED'i ELLE-DOĞRULANDI yeşildi (worker scoreAll fix sonrası).

**Yapıldı (T0-onaylı FÜZYON):**
- `bin/lib/bench.ts` +`isStale(ts,maxDays)` (tazelik; geçersiz→güvenli-stale). tests +4.
- `bin/lib/benchprompt.ts` +`LocalSelection` + `selectionLines` + `stale` uyarı: localSelection VARSA donanım-duyarlı
  selectBest pick + RAM-tier config (HARDCODED M4 yerine), YOKSA champion fallback. tests +3.
- `bin/benchprompt.ts` = TEK KANONİK CLI yeniden-yazıldı: canlı sysctl(M4) → bench.aggregate → **optimize.selectBest**
  + optimalConfig → buildModelSelectionPrompt(localSelection) → **MODEL_PROMPT.md** + **MODEL_SELECTION.json**; stale + `--refresh` opt-in.
- SİL: `bin/optimize.ts`(CLI) + OPTIMAL_PROMPT.md + OPTIMAL.json (optimize LIB KORUNDU — conduct kullanıyor).
- `bin/role.ts` +🏆 optimal-runtime satırı (MODEL_SELECTION.json). tests +2.
- `bin/conduct.ts` ref-onarımı (OPTIMAL.json→MODEL_SELECTION.json, optimize.ts→benchprompt.ts) — silmemin dangling-ref'i; conduct vO8 commit-DIŞI.

**Kanıt (canlı):** vitest **286/24** yeşil. `tsx bin/benchprompt.ts` → M4 Max 52GB algıla → **0-manuel selectBest
`qwen3-coder:30b`** (119.7 tok/s, skor 0.913, correctness-gate✓+VRAM-fit✓) → RAM-tier num_ctx=8192 → MODEL_PROMPT.md
(Tier-A routing + donanım-optimal pick FÜZYON) + MODEL_SELECTION.json; **⚠️ STALE uyarısı** (benchmark.json 6 gün). role.ts
→ 🏆 optimal satırı. Scope: orchestration/** + ~/.llm-mission-control(refresh opt-in); 8 lane 0 yazım.

**RISK-ORCH-013:** 4-worker prompt-proliferation→füzyon; cross-dep silme (conduct→optimize) ref-tara; stale-bench (isStale+opt-in-refresh, sürekli-tazelik bench-lane işi); versiyon-etiket drift (optimize 'vO7'≠ROADMAP).

**Next precomputed (→vO7):** drift-guard (branch≡roadmap; optimize.ts header vO7→vO6 düzelt). benchprompt: per-task champ + iOS device kolonu.

---

## vO9 — Quality-Gate Roll-Up + Conduct Wiring (2026-06-20)

**Tetik (Emre/T0):** "sıradaki versiyonu planla" + **YARIM bırakma, eksik tespit et, eş zamanlı gerekenleri yap,
tamamlamadan sonraki adıma geçme**, 0-manuel kapsayıcı.

**Yapıldı:**
- `bin/lib/quality.ts` (saf): parseTscResult ("Found N errors"/error-TS-sayım) + parseLastRun (vitest .last-run.json) +
  rollup (tsc-fail VEYA test-failed → RED; conduct-uyumlu `redLanes{lane,detail}[]`) + toQualityTable. test 9/9.
- `bin/quality.ts` CLI: discoverWorktrees → her lane `tsc --noEmit` CANLI (stateless, kendi node_modules/.bin/tsc,
  timeout 45s, tsconfig-yoksa skip) + `.last-run.json` cache (mtime→isStale) → QUALITY.md/QUALITY.json. **vitest CANLI
  KOŞULMAZ** (pahalı+flaky, UK-08). `--no-tsc` cache-only.
- **EŞ-ZAMANLI (kritik): CONDUCT WIRING** — conduct.ts:73 `redLanes:[]`→`QUALITY.json.redLanes`. Roll-up artık ORPHAN
  DEĞİL, autonomous conductor tüketir.
- `role.ts` +🩺 lane-health satırı (QUALITY.json totals) + test +2.

**BUG-FIX (no-half kanıtı):** CANLI conduct koşusu (Phase-6 verify) vO6'dan kalan YARIM ref-onarımı yakaladı —
`optimal.config.num_ctx` summary-satırı MODEL_SELECTION.json nested-shape'e güncellenmemişti → conduct.ts:109 CANLI
TypeError crash (test mock-data ile geçmiş, yakalamamış). Fix: `optimal?.selection.config?.num_ctx` guard. **Ders
RISK-ORCH-014:** ref-shape refactor'unda TÜM kullanımları grep'le + CANLI koş (mock yetmez).

**Kanıt (uçtan-uca 0-touch):** vitest **339/24** yeşil. `tsx bin/quality.ts` → 9 lane gerçek matris (backend🔴 test-failed,
frontend🟢, 7⚪). `tsx bin/conduct.ts` → QUALITY.redLanes tüketti → **eylem=RED:backend** (CONDUCTOR.md `[RED] backend:
test failed`), exit=1 gate. `role.ts` → 🩺 1🟢/1🔴/7⚪. Scope: orchestration/** + per-lane tsc read-only (0 lane-yazım).

**Next precomputed (→vO10):** Heartbeat/notification (idle-lane + takılı-tab); worker heartbeat.ts draftı var → konsolide.
quality genişletme: live-eslint (frontend), coverage%, gh-api CI-status, turbo-affected-only roll-up.
