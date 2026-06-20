# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-20T12:37:00.912Z · 5/7 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 5/7 adım başarılı · 2026-06-20T12:37:00.912Z
**Model seçimi (0-manuel-seçim):** model seçimi tazelendi
**Conductor sonraki-aksiyon:** —
**Readiness (0-manuel aktif mi):** 🛑 NO-GO — 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL)

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 121ms | model seçimi tazelendi |
| ✓ | `critic` | 103ms | completeness skor 98 · 1 açık |
| ✓ | `dod` | 105ms | DoD skor 60 · 8 yarım-iş |
| ✗ | `conduct` | 2564ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `fuse` | 2585ms | hazırlık 49/100 · top SECURITY:lic:f/prompts.chat |
| ✓ | `status` | 7956ms | lane matrisi tazelendi |
| ✗ | `doctor` | 155ms | 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL) |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
