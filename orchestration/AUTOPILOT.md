# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-20T13:07:44.468Z · 5/7 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 5/7 adım başarılı · 2026-06-20T13:07:44.468Z
**Model seçimi (0-manuel-seçim):** model seçimi tazelendi
**Conductor sonraki-aksiyon:** —
**Readiness (0-manuel aktif mi):** 🛑 NO-GO — 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL)

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 163ms | model seçimi tazelendi |
| ✓ | `critic` | 135ms | completeness skor 100 · 0 açık |
| ✓ | `dod` | 141ms | DoD skor 64 · 8 yarım-iş |
| ✗ | `conduct` | 2730ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `fuse` | 2695ms | hazırlık 66/100 · top COMPLETENESS:dod:concurrent-task:adopt-gate |
| ✓ | `status` | 10091ms | lane matrisi tazelendi |
| ✗ | `doctor` | 170ms | 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL) |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
