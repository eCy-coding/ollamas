# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-20T12:11:25.717Z · 4/6 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 4/6 adım başarılı · 2026-06-20T12:11:25.717Z
**Model seçimi (0-manuel-seçim):** model seçimi tazelendi
**Conductor sonraki-aksiyon:** —
**Readiness (0-manuel aktif mi):** 🛑 NO-GO — 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL)

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 102ms | model seçimi tazelendi |
| ✓ | `critic` | 101ms | completeness skor 60 · 7 açık |
| ✓ | `dod` | 106ms | DoD skor 39 · 12 yarım-iş |
| ✗ | `conduct` | 3394ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `status` | 8305ms | lane matrisi tazelendi |
| ✗ | `doctor` | 136ms | 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL) |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
