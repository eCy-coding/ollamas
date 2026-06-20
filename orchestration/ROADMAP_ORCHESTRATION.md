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
| vO6 | planned | Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid-MLX bench adopt) |
| **vO6.1** | ✅ DONE | **Benchmark → taşınabilir model-seçim PROMPT'u** — `benchprompt.ts` BENCH.json'ı (worker bench-core) read-only CONSUME + Tier-A routing (plan.md §1) füzyon → `MODEL_PROMPT.md` (global-standart sectioned, paste-anywhere; correctness-gate→tok/s; self-update). Adopt pattern: f/prompts.chat + structured-prompts; RouteLLM idea-only. Commit-izole (lokal tip, worker bench.ts'e bağımsız) |
| **vO7** | ✅ DONE | **Work-Claim Ledger** (duplikasyon önleme) — `claims.ts` atomic `mkdirSync`-lock + append-only `seyir/work-claim.jsonl` LWW ledger (ts→fence→tab) + TTL/heartbeat **stale-takeover** + monoton **fencing** + `claim.ts` CLI (claim/--check/--list/--renew/--done/--release); `plan-next.ts` trigger collision-gate (--claim auto) + `status.ts` additive claim sinyali; **ORCHESTRATION_AGENTS §13**. Kök-fix: oturum-içi plan.md×2 + kimlik×2 duplikasyonu (ERR-ORCH-013). Adopt: proper-lockfile (MIT) + JSONL LWW + fencing token (idea, zero-dep). claims.test 15; full 248 |
| vO8 | planned | Drift-guard otomasyon (branch≡roadmap, choke-point bütünlüğü) |
| vO9 | planned | Quality-gate roll-up (tüm lane tsc/lint/test tek matriste) |
| vO10 | planned | Heartbeat/notification (idle-lane + takılı-tab tespiti) |
| vO11 | planned | Self-review + completeness critic (eksik koordinasyon ne?) |

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
