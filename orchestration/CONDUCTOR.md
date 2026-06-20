# CONDUCTOR — Zero-Touch Orkestrasyon (otonom)

> `conduct.ts` üretti. 0 manuel seçim/işlem: tüm araçlar koşuldu, öncelik motoru tek eylem seçti.
> 2026-06-20T12:11:29.381Z · Bulgular: RED:1 · SECURITY:1 · COMPLETENESS:19 · ROADMAP:4 · Delta: +2 yeni · -8 çözülen · 23 süregelen

## Birleşik durum
| Lane | Şu an | → Sıradaki | dirty | idle |
|------|-------|-----------|-------|------|
| `backend` | ✅ ~~Per tenant upstream tool visibility izolasyo | ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF | 1△ | ✓ |
| `cli` | v13 — DONE (kanıt) | v14 TUI v2 / agent watch top multi pane (request | 4△ | ✓ |
| `frontend` | ✅ Faz 13 v1.4 (Production Operations Hardening,  | — | 21△ | ✓ |
| `general` | ✅ ~~roots/list upstream agregasyonu + abort prop | — | 0△ | ✓ |
| `ukp` | ✅ ~~roots/list upstream agregasyonu + abort prop | ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF | 0△ | ✓ |
| `gateway` | ✅ Per tenant upstream tool visibility izolasyonu | — | 2△ | ✓ |
| `orchestration` | — | — | 49△ | ✓ |
| `scripts` | 2. ✅ e2e test ( bridge e2e.test.ts , describe.sk | Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done.  | 1△ | ✓ |
| `tunnel` | — | — | 0△ | ✓ |
| `v` | ✅ Faz 15 v1.6 (MCP Ecosystem Interop + Auth Comp | — | 7△ | ✓ |

**Bench:** 🏆 qwen3-coder:30b 119.7 tok/s · **Optimal:** — · **Lane:** 10 · **Toplam:** 85△ 0💤 28✗

## 🎯 SIRADAKI TEK EYLEM (priority engine seçti)
**Tier:** RED · **Lane:** backend

**Durum:** test failed

**Eylem:** backend: kırık gate/testi düzelt (her şeyi bloklar)

## Tüm bulgular (öncelik sırası)
1. **[RED]** backend: test failed
2. **[SECURITY]** global: Lisans ihlali: f/prompts.chat — copyleft: 'ADOPT' kod kopyalama ima eder — yalnız ref-only/idea-only/eval-only/future-ref izinli (RISK-ORCH-005)
3. **[COMPLETENESS]** orchestration: vO13 (Horizon auto roadmap (10 versiyon lookahead) lib hazır, cond) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)
4. **[COMPLETENESS]** orchestration: shared.ts (4 export) test'te geçmiyor — yarım iş
5. **[COMPLETENESS]** orchestration: autopilot.ts ve horizon.ts amaç-örtüşmesi yüksek (2 ortak kelime) — olası duplicate
6. **[COMPLETENESS]** orchestration: conduct.ts ve serve.ts amaç-örtüşmesi yüksek (2 ortak kelime) — olası duplicate
7. **[COMPLETENESS]** orchestration: doctor.ts ve model-hook.ts amaç-örtüşmesi yüksek (3 ortak kelime) — olası duplicate
8. **[COMPLETENESS]** orchestration: model-hook.ts ve role-hook.ts amaç-örtüşmesi yüksek (5 ortak kelime) — olası duplicate
9. **[COMPLETENESS]** orchestration: Commit'siz yeşil iş (built-not-shipped): ADOPTIONS_ORCHESTRATION.md, AUTOPILOT.md, CONDUCTOR.md, DOCTOR.md, DRIFT.md, MODEL_PROMPT.md…
10. **[COMPLETENESS]** orchestration: vO4.2 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
11. **[COMPLETENESS]** orchestration: vO4.1 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
12. **[COMPLETENESS]** orchestration: adopt-gate kısmen tamam — eksik eş-zamanlı: test
13. **[COMPLETENESS]** orchestration: claim kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
14. **[COMPLETENESS]** orchestration: driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
15. **[COMPLETENESS]** orchestration: fuse kısmen tamam — eksik eş-zamanlı: roadmap-row
16. **[COMPLETENESS]** orchestration: scan kısmen tamam — eksik eş-zamanlı: test
17. **[COMPLETENESS]** orchestration: shared kısmen tamam — eksik eş-zamanlı: test
18. **[COMPLETENESS]** orchestration: status kısmen tamam — eksik eş-zamanlı: test
19. **[COMPLETENESS]** orchestration: lib/collect.ts: test'siz export → liveTabMap
20. **[COMPLETENESS]** orchestration: lib/signal.ts: test'siz export → notify
21. **[COMPLETENESS]** orchestration: fuse aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
22. **[ROADMAP]** backend: backend sıradaki: ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
23. **[ROADMAP]** cli: cli sıradaki: v14 TUI v2 / agent watch top multi pane (request
24. **[ROADMAP]** ukp: ukp sıradaki: ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
25. **[ROADMAP]** scripts: scripts sıradaki: Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. 

## Optimal working-prompt (seçili eyleme hazır)
_(MODEL_SELECTION.json yok — `tsx orchestration/bin/benchprompt.ts` koş)_
