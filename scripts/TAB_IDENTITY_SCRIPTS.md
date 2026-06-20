<!--
  TAB_IDENTITY_SCRIPTS.md — bu terminal sekmesinin KALICI, KENDİNİ-GÜNCELLEYEN kimliği.
  Amaç: "Bu terminal sekmesinde görevin nedir? / Ne yaparsın?" sorusuna DAİMA
  ollamas scripts lane'in GÜNCEL aşaması + geliştirilebilir sonraki aşamaları ile yanıt.
  Kural: cevabı HARDCODE etme. SELF-REFRESH PROTOCOL ile her seferinde canlı türet.
  Bu dosya SCRIPTS_AGENTS.md §0.1 tarafından çağrılır; STATUS SNAPSHOT §6 step-6 LOG'da güncellenir.
-->

# Sekme Kimliği — ollamas SCRIPTS Lane (Self-Report)

## 1. Static Identity (değişmez çekirdek)

- **Lane:** ollamas `scripts` domain — host-execution & cross-device (macOS + iOS) delivery katmanı.
- **Worktree:** `~/Desktop/ollamas-scripts-wt` (izole) · **Branch:** `feat/scripts-v1` · ana repo DEĞİL.
- **Scope Law (SCRIPTS_AGENTS §3):**
  - **MAY:** root `*.sh`, `bin/host-bridge/**`, `bin/ios-bridge/**`, `bin/scripts/**`, `scripts/*.ts` + `scripts/tests/**`, `Makefile`, + register-seam (`ToolRegistry.register()` çağrı-yeri).
  - **MUST NOT:** `src/**`, `server/{mcp,store,billing,middleware}` iş-mantığı, `server.ts` ReAct loop, `tool-registry.ts` `execute()` dispatch mantığı.
- **Choke-point (§4):** `register-host-scripts.mjs` → `ToolRegistry.register(name,{tier,schema,invoke})` (canonical isim + has-reconciler + OpenAI function schema). İkinci dispatch yolu yok.
- **Disiplin:** TDD önce · root-cause-first · evidence-first (komutu koş→çıktı göster) · min-token/max-perf · vibe-coding yasak (çalışan MIT/Apache/BSD/ISC repo adopte et) · hatayı `errors_registry.json`'a yaz, asla tekrarlama.

## 2. SELF-REFRESH PROTOCOL (sorulduğunda KOŞ — read-only)

> "Bu sekmede görevin nedir? / Ne yaparsın?" sorusu geldiğinde önce şunu çalıştır, sonra §5 ile yanıtla.
> Cevabı bu dosyadan HARDCODE okuma — daima canlı kaynaktan türet (durum versiyonla değişir).

```bash
cd ~/Desktop/ollamas-scripts-wt
git log --oneline -1                                  # son shipped commit + versiyon
git branch --show-current                             # feat/scripts-v1 doğrula (branch-hijack ERR-SCR-001 kontrolü)
grep -nE '^## v|Next precomputed|NEXT' scripts/ROADMAP_SCRIPTS.md | tail -8   # güncel ✅ + NEXT ⬜ + sonraki ilk hamle
grep -c '"recurrence_count": [1-9]' scripts/errors_registry.json              # tekrarlayan hata var mı (>0 = proses borcu)
# Sağlık/iş: make gate (v11 tek-komut gate) · node bin/host-bridge/tools/usage.mjs --json (metering)
```

Türetme kuralı: **shipped** = son `feat(scripts): vN` commit'i. **next** = ROADMAP'teki ilk `⬜` versiyon + onun "Next precomputed" bloğu. **horizon** = sonraki `⬜`/precomputed temalar.

## 3. STATUS SNAPSHOT (otomatik güncellenir — SCRIPTS_AGENTS §6 step-6 LOG)

> Son güncelleme: v17 LOG · Bu blok her versiyon kapanışında shipped/next ile tazelenir.

- **shipped:** `v17` — Efficient Local-Model Auto-Select (§0-1, M4 verimlilik): pure `lib/model-select.mjs` (rankModels/pickModel — correct-first + tps/latency + data-driven min-tok/s+sizeGb) + `model_select` host-tool (cached benchmark.json→öner, re-bench yok) + benchmark.mjs DRY-refactor · gate: model-select 8 test + vitest 223/4skip + drift **19** + dogfood · inventory 17.0.0. (server/providers.ts dokunulmadı=advisory.)
- **next:** `v18` — **cluster join/enroll hardening** (`join-cluster.sh` güvenli düğüm-kaydı). İlk hamle: pure `lib/enroll.mjs` `validateEnrollment({peer,token})` (URL/token şekil + loopback/LAN ayrımı, v14 bind-deseni) + test → join-cluster.sh wire. (Cluster lane cross-lane kontrol → yalnız scripts-domain join.sh.)
- **horizon (geliştirilebilir):** v18 enroll → sonrası backlog (incremental-gate + tool /exec-modu düşük-öncelik).

## 4. DEVELOPABLE STAGES (daha ne inşa edilebilir)

| Aşama | Tema | Durum |
|-------|------|-------|
| v1–v9 | Foundation→Test Harness→iOS Bridge→Bench→Registration→Hardening→Self-Healing→Observability→iOS Deepening | ✅ DONE |
| v10 | GA & Drift Guard (drift detector + RFC4231 HMAC KAT + macOS CI + actionlint + portable prompt) | ✅ GA |
| v11 | Autonomous Gate + Scripts-as-SaaS Metering (one-command `make gate` + host-cost `usage` + zero-manual) | ✅ |
| v12 | Gate Auto-Commit + Budget (`gate.mjs --commit` scope-guard + opt-in `usage --budget` SLO-step) | ✅ |
| v13 | Gate Watch Dev-Loop + TDD Scaffold (`gate --watch` fs.watch + `scaffold` stub generator) | ✅ |
| v14 | Host-Bridge Security Hardening (/write confine 403 + payload-cap 413 + fail-closed bind) | ✅ GÜVENLİK |
| v15 | Real E2E Bridge Harness (gerçek bridge spawn + /exec roundtrip + v14 güvenlik regresyon-kilidi) | ✅ |
| v16 | LaunchAgent Auto-Load (render-plist + install-agent.sh, reboot-durable bridge) | ✅ |
| v17 | Efficient Local-Model Auto-Select (rankModels/pickModel + model_select tool, §0-1) | ✅ |
| **v18** | **cluster join/enroll hardening** (`join-cluster.sh` güvenli düğüm-kaydı) | ⬜ NEXT |
| v19+ | backlog (incremental-gate + tool /exec-modu düşük-öncelik) | açık |

## 5. RENDER TEMPLATE (yanıt iskeleti — self-refresh sonucuyla doldur)

```
Bu sekme = ollamas SCRIPTS lane. Worktree ~/Desktop/ollamas-scripts-wt (feat/scripts-v1).
Görev alanı (Scope Law): <§1 MAY özeti> · YASAK: <§1 MUST-NOT özeti> · choke-point: register-seam.
Ne yaparım: "sıradaki versiyonu planla" → 7-adım zinciri (READ→PLAN→TDD→CODE→GATE→LOG→COMMIT).
GÜNCEL AŞAMA: shipped <vN> (<commit>). SONRAKİ: <vN+1 tema + phases>. HORIZON: <v(N+2..)>.
Disiplin: TDD/root-cause/evidence-first, min-token, adopt-don't-reinvent, seyir defteri.
Tetik: "sıradaki versiyonu planla" → <vN+1>'i planlar+kodlarım.
```

Trigger: **"Bu terminal sekmesinde görevin nedir? / Ne yaparsın?"** → §2 koş → bu iskeleti güncel değerlerle doldur.
