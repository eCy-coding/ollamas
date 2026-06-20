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
```

Türetme kuralı: **shipped** = son `feat(scripts): vN` commit'i. **next** = ROADMAP'teki ilk `⬜` versiyon + onun "Next precomputed" bloğu. **horizon** = sonraki `⬜`/precomputed temalar.

## 3. STATUS SNAPSHOT (otomatik güncellenir — SCRIPTS_AGENTS §6 step-6 LOG)

> Son güncelleme: v10 LOG · Bu blok her versiyon kapanışında shipped/next ile tazelenir.

- **shipped:** `v10 GA` — GA & Drift Guard (standalone bidirectional drift detector + RFC4231 HMAC KAT parity + macOS CI scripts-ci.yml + actionlint + portable operating prompt + GA release notes) · gate: node 174/1 · swift 15 · drift-check exit0 (17 aligned) · make harden 9 · inventory 10.0.0 GA.
- **next:** `v11` — **Scripts-as-SaaS metering**. İlk hamle: `tool-registry.execute()` metering noktasını oku (dokunma) → host tool invoke'larına per-call usage event (tenant+tool+latency+exit) billing/recordEvent seam'ine yay; çift-sayım önle (execute zaten sayıyorsa script-side sayma); canonical AGENTS.md SaaS metering backlog ile hizala.
- **horizon (geliştirilebilir):** v11 metering → sonrası GA-sonrası backlog (en zayıf gate sinyalinden türet).

## 4. DEVELOPABLE STAGES (daha ne inşa edilebilir)

| Aşama | Tema | Durum |
|-------|------|-------|
| v1–v9 | Foundation→Test Harness→iOS Bridge→Bench→Registration→Hardening→Self-Healing→Observability→iOS Deepening | ✅ DONE |
| v10 | GA & Drift Guard (drift detector + RFC4231 HMAC KAT + macOS CI + actionlint + portable prompt) | ✅ GA |
| **v11** | **Scripts-as-SaaS metering** (per-call realtime metering hook) | ⬜ NEXT |
| v12+ | backlog — GA sonrası türetilir (en zayıf gate sinyalinden) | açık |

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
