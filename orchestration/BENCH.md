# BENCH — Benchmark Agregasyon (MacBook + iOS tok/s)

> READ-ONLY `bench.ts` üretti. Kaynak: benchmark.json, cli-bench.json, calibration.json.
> 4 kayıt · 4 model×device grubu · 1 cihaz · chip Apple M4 Max.

## 🏆 Cihaz başına en-verimli DOĞRU model
- **mac**: 🏆 `qwen3-coder:30b` — 119.7 tok/s (doğru)

### mac (Apple M4 Max)

| Model | Median tok/s | p95 | ±MAD | Koşu | Doğru% | Trend |
|---|--:|--:|--:|--:|--:|---|
| qwen3-coder:30b 🏆 | 119.7 | 119.7 | 0 | 1 | 100 | ▄▄▄ |
| qwen3:4b | 111 | 111 | 0 | 1 | 0 | ▄▄▄ |
| gpt-oss:20b | 88.9 | 88.9 | 0 | 1 | 100 | ▄▄▄ |
| qwen3:8b | 81.4 | 81.4 | 0 | 1 | 100 | ▄▄▄ |

## ✅ Regresyon yok (baseline'a göre)

---
_Agregasyon read-only; runner'ı lane'ler koşar. tok/s=median (mean değil, outlier-robust). Trend=min·median·max sparkline._
