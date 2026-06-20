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

> Son güncelleme: v11 LOG · Bu blok her versiyon kapanışında shipped/next ile tazelenir.

- **shipped:** `v11` — Autonomous Gate + Scripts-as-SaaS Metering (zero-manual): tek-komut `make gate` (pure runGate, exit-code zorunlu) + host-cost metering `usage` tool (tier-weighted billable units + budget) + ZERO-MANUAL DECISION DEFAULTS · gate: GATE GREEN (tsc/vitest 185-1/harden 9/drift 18/swift 15, actionlint skip) · inventory 11.0.0.
- **next:** `v12` — **gate auto-commit + budget enforcement**. İlk hamle: `gate.mjs --commit` modu (yeşilde per-file auto-stage + conventional commit, push hariç, scope-guard scripts/+bin/) + `usage --budget`'i `make gate`'e opsiyonel SLO-step.
- **horizon (geliştirilebilir):** v12 auto-commit/budget → sonrası backlog (en zayıf gate sinyalinden türet).

## 4. DEVELOPABLE STAGES (daha ne inşa edilebilir)

| Aşama | Tema | Durum |
|-------|------|-------|
| v1–v9 | Foundation→Test Harness→iOS Bridge→Bench→Registration→Hardening→Self-Healing→Observability→iOS Deepening | ✅ DONE |
| v10 | GA & Drift Guard (drift detector + RFC4231 HMAC KAT + macOS CI + actionlint + portable prompt) | ✅ GA |
| v11 | Autonomous Gate + Scripts-as-SaaS Metering (one-command `make gate` + host-cost `usage` + zero-manual) | ✅ |
| **v12** | **gate auto-commit + budget enforcement** (`gate.mjs --commit` + `usage --budget` SLO-step) | ⬜ NEXT |
| v13+ | backlog — türetilir (en zayıf gate sinyalinden) | açık |

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
