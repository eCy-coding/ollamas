# REQUIREMENTS — Birleşik Kritik Gereksinimler (füzyon)

> READ-ONLY `fuse.ts`: tüm analizör (conduct/critic/dod/quality) → tek critical-first liste.
> **Proje hazırlık: 97/100** · 1 gereksinim (dedupe edilmiş). Kaynak: yeni analiz yok, mevcut füzyon.

## 🎯 EN KRİTİK GEREKSİNİM
**Criticality:** COMPLETENESS · **Kaynak:** dod

**Gereksinim:** Commit'siz yeşil iş (built-not-shipped): COUNCIL_ROSTER.json, CRITIC.json, CRITIC.md, DOD.json, DOD.md, QUALITY.json…

**Eylem:** yeşil parçayı commit'le (per-file git add + conventional)

## Tüm gereksinimler (critical-first)
### COMPLETENESS (1)
- **dod:uncommitted-green:9 dosya** [dod]: Commit'siz yeşil iş (built-not-shipped): COUNCIL_ROSTER.json, CRITIC.json, CRITIC.md, DOD.json, DOD.md, QUALITY.json…
  → yeşil parçayı commit'le (per-file git add + conventional)

## Kaynak tazelik (eşik 60dk)
| Kaynak | ts | Durum |
|---|---|---|
| conduct | (canlı exec) | ✓ taze |
| critic | 2026-07-04T11:05:13.622Z | ✓ taze |
| dod | 2026-07-04T11:05:13.895Z | ✓ taze |
| quality | 2026-07-04T11:05:42.316Z | ✓ taze |

## Optimal working-prompt (en-kritik eyleme)
# OLLAMAS — OPTIMAL WORKING PROMPT (self-optimizing, portable)

> Bu blok nereye yapıştırılırsa orada ollamas için EN-VERİMLİ seçimle çalışmaya başlar.
> `optimize.ts` üretti — benchmark-driven, deterministik. Bench/calibration değişince seçim otomatik güncellenir.

<context>
Donanım: Apple M4 Max · 52GB unified · 16 core · arm64.
Proje: ollamas (yerel MCP gateway + tools-as-SaaS). Çalışma prensipleri: choke-point, TDD, evidence-first, no-vibe-code, zero-dep, correctness>hız.
</context>

<selected-runtime>
Model: **qwen3-coder:30b** — benchmark-seçili (114.6 tok/s, doğru; correctness-gate ✓; skor 0.913).
Gerekçe: correct 1 + tok 114.6/114.6 + vram-fit 0.57
Optimal Ollama/MLX config:
  num_ctx=8192  num_gpu=999  num_thread=12  keep_alive=30m  quant=Q4_K_M
Runtime: Apple Silicon → Ollama ≥0.19 MLX backend (num_gpu=999 tüm-Metal); warm-model (keep_alive) reload latency'yi siler.
</selected-runtime>

<task>
Verilen görevi bu model+config ile yürüt. Yeni görev gelince önce `tsx orchestration/bin/optimize.ts` koş → o anki en-verimli seçimi al.
</task>

<constraints>
- Kod-bütünlüğü: ollamas choke-point (ToolRegistry.execute) tek-dispatch; TDD (test önce); evidence-first (çalışıyor=komut çıktısı göster).
- No vibe-code: hazır OSS adopt (MIT/Apache kopya+attribution, GPL ref-only); zero-dep tercih.
- Correctness > hız: yanlış-ama-hızlı model diskalifiye (correctness-gate 0.7).
- Kalite kapısı: typecheck + lint + test taze koşu → conventional commit.
</constraints>

<format>
Sıra: READ → PLAN → TDD → BUILD → VERIFY(kanıt) → SHIP. Çıktı net, token-yalın.
</format>

<example>
İyi: "qwen3-coder:30b num_ctx=8192 ile koştum → test 12/12 yeşil (çıktı altta)."
Kötü: "Çalışıyor." (kanıtsız — reddet.)
</example>

<next-action>
yeşil parçayı commit'le (per-file git add + conventional)
</next-action>

---
_fuse füzyon yapar; eylem conduct/lane (§3). REQUIREMENTS.json → conduct beslemesi._
