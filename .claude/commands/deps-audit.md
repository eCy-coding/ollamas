---
description: $0 bağımlılık denetimi — Trivy + npm audit → zafiyetli paket + supply-chain riski
---

Bağımlılıkları ücretsiz araçlarla denetle. Read-only.

Çalıştır:
1. `trivy fs --scanners vuln --severity CRITICAL,HIGH --quiet --list-all-pkgs package-lock.json` (yoksa `package.json`) — bilinen CVE'li paketler.
2. `npm audit --json` — npm advisory DB (offline değilse). Çıktıyı parse et.
3. Lockfile var mı + ne tür (npm/bun/pnpm) doğrula: `ls package-lock.json bun.lockb pnpm-lock.yaml 2>/dev/null`.

Tablo:
| paket@versiyon | sev | CVE/advisory | düzeltilen versiyon | direkt/transitif |
|---|---|---|---|---|

Kurallar:
- ollamas ZERO-DEP runtime hedefler (cli/** node built-ins only) — runtime dep çıkarsa AYRICA flag'le (scope ihlali sinyali).
- CRITICAL/HIGH önce. Düzeltme: `npm i pkg@fixed` veya transitif için override önerisi.
- Bulgu yoksa "0 zafiyet" + taranan paket sayısı.
- Evidence-first: gerçek çıktı. Kapanış: en riskli 3 + upgrade komutu.
