# SİRİ LOG RAPORU — 2 kayıt

## Route dağılımı
- oracle: 1 (%50)
- research: 1 (%50)

## Metrikler
- cache-hit: 0/2 (%0)
- error oranı: %0
- confidence ort: %82 · histogram [0-20|20-40|40-60|60-80|80-100]: 0 | 0 | 0 | 0 | 1
- gecikme total: p50 **16794ms** · p95 **16794ms** (ort 8403ms, 2 örnek)
- gecikme kırılımı: deep ort 2466ms · synth ort 14315ms

## En sık top-3 domainler
- oracle.com: 1
- cloud.google.com: 1
- aws.amazon.com: 1

## Synth backend dağılımı
- fleet:win: 1

## Sağlık / SLO (son 1 kayıt)
- **Durum: PASS** (SLO: error≤%5 · conf≥%60 · p95≤35000ms)
  - ✓ error: %0
  - ✓ confidence: %82
  - ✓ p95: 16794ms

## Drift (recent 1 vs baseline 1)
- confidence: —
- p95 gecikme: +152573%
- error oranı: 0.0 puan
