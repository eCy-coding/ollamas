# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-24T10:43:09.546Z · 7/8 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 7/8 adım başarılı · 2026-06-24T10:43:09.546Z
**Model seçimi (0-manuel-seçim):** model seçimi tazelendi
**Conductor sonraki-aksiyon:** —
**Readiness (0-manuel aktif mi):** ✅ GO — 0-manuel tam canlı + taze
**Staleness self-heal (0-manuel taze):** bench taze (fresh) → refresh gereksiz, atla

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `heal` | 21ms | bench taze (fresh) → refresh gereksiz, atla |
| ✓ | `benchprompt` | 453ms | model seçimi tazelendi |
| ✓ | `critic` | 586ms | completeness skor 94 · 1 açık |
| ✓ | `dod` | 518ms | DoD skor 70 · 6 yarım-iş |
| ✗ | `conduct` | 9283ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `fuse` | 11349ms | hazırlık 40/100 · top CRITICAL:red:integration/v17-core |
| ✓ | `status` | 32683ms | lane matrisi tazelendi |
| ✓ | `doctor` | 495ms | 0-manuel tam canlı + taze |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
