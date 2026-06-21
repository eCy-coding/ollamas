# QUALITY — Tüm-Lane Sağlık Matrisi (vO9, 0-manuel)

> READ-ONLY `quality.ts` üretti · 2026-06-20T11:41:46.254Z · tsc CANLI + vitest .last-run cache.
> **🟢 1 green · 🔴 1 red · ⚪ 7 unknown** (toplam 9 lane).

| Lane | tsc | test (son koşu) | dirty | Durum |
|------|-----|------------------|-------|-------|
| `backend` | ✓ | failed | 1△ | 🔴 RED |
| `cli` | ✓ | unknown | 0△ | ⚪ unknown |
| `frontend` | ✓ | passed | 3△ | 🟢 GREEN |
| `general` | ✓ | unknown | 0△ | ⚪ unknown |
| `gateway` | ✓ | unknown | 0△ | ⚪ unknown |
| `orchestration` | — | unknown | 32△ | ⚪ unknown |
| `scripts` | ✓ | unknown | 10△ | ⚪ unknown |
| `tunnel` | — | unknown | 20△ | ⚪ unknown |
| `v` | ✓ | unknown | 6△ | ⚪ unknown |

## 🔴 RED lane'ler (conductor'a sinyal)
- **backend**: test failed

---
_vitest CANLI koşulmaz (cache tüketilir); tsc stateless read-only. Gap'i conductor fixlemez → lane sekmesine backlog (§3)._
