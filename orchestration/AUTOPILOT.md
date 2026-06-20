# AUTOPILOT — 0-manuel orkestrasyon tazelemesi
<!-- AUTO autopilot.ts · 2026-06-20T11:08:24.275Z · 2/3 adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->

> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.
> Operatör komut çalıştırmaz (0-manuel-işlem).

**Durum:** 2/3 adım başarılı · 2026-06-20T11:08:24.275Z
**Model seçimi (0-manuel-seçim):** pick qwen3-coder:30b · 119.7 tok/s · ⚠️ STALE
**Conductor sonraki-aksiyon:** —

| | Adım | Süre | Detay |
|---|---|--:|---|
| ✓ | `benchprompt` | 134ms | pick qwen3-coder:30b · 119.7 tok/s · ⚠️ STALE |
| ✗ | `conduct` | 2481ms | Command failed: /Users/emrecnyngmail.com/Desktop/ollamas/node_modules/.bin/tsx / |
| ✓ | `status` | 8364ms | lane matrisi tazelendi |

_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._
