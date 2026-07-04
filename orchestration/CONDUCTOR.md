# CONDUCTOR — Zero-Touch Orkestrasyon (otonom)

> `conduct.ts` üretti. 0 manuel seçim/işlem: tüm araçlar koşuldu, öncelik motoru tek eylem seçti.
> 2026-07-04T11:00:20.403Z · Bulgular: COMPLETENESS:1 · STALE:8 · Delta: değişiklik yok (idempotent — son koşuyla aynı)

## Birleşik durum
| Lane | Şu an | → Sıradaki | dirty | idle |
|------|-------|-----------|-------|------|
| `backend` | P4 Migration drift fix — migrations.ts v4 guarde | — | 84△ | ✓ |
| `colab` | P4 Migration drift fix — migrations.ts v4 guarde | — | 13△ | ✓ |
| `fix/audit-security` | P4 Migration drift fix — migrations.ts v4 guarde | — | 3△ | 💤 |
| `verify/gwv2-all-lanes` | P4 Migration drift fix — migrations.ts v4 guarde | — | 0△ | 💤 |
| `fix/binary-architecture-calibration` | P4 Migration drift fix — migrations.ts v4 guarde | — | 12△ | 💤 |
| `fix/audit-cont` | P4 Migration drift fix — migrations.ts v4 guarde | — | 1△ | ✓ |
| `claude/cool-cohen-b245ee` | P4 Migration drift fix — migrations.ts v4 guarde | — | 1△ | 💤 |
| `claude/determined-bartik-0090ba` | P4 Migration drift fix — migrations.ts v4 guarde | — | 4△ | 💤 |
| `claude/loving-varahamihira-77d4a9` | ✅ Faz 12 v1.3 (Postgres + async store, multi rep | — | 1△ | 💤 |
| `claude/naughty-kowalevski-2ccc35` | ✅ Faz 12 v1.3 (Postgres + async store, multi rep | — | 566△ | 💤 |
| `req-sweep` | P4 Migration drift fix — migrations.ts v4 guarde | — | 31△ | ✓ |
| `(detached)` | P4 Migration drift fix — migrations.ts v4 guarde | — | 0△ | 💤 |

**Bench:** veri yok · **Optimal:** qwen3-coder:30b num_ctx=8192 · **Lane:** 12 · **Toplam:** 716△ 8💤 80✗

## 🎯 SIRADAKI TEK EYLEM (priority engine seçti)
**Tier:** COMPLETENESS · **Lane:** orchestration

**Durum:** Commit'siz yeşil iş (built-not-shipped): .autopilot-refresh.json, AUTOPILOT.md, CLAUDE_DISPATCH.md, CONDUCTOR.md, COUNCIL_ROSTER.json, CRITIC.json…

**Eylem:** yeşil parçayı commit'le (per-file git add + conventional)

## Tüm bulgular (öncelik sırası)
1. **[COMPLETENESS]** orchestration: Commit'siz yeşil iş (built-not-shipped): .autopilot-refresh.json, AUTOPILOT.md, CLAUDE_DISPATCH.md, CONDUCTOR.md, COUNCIL_ROSTER.json, CRITIC.json…
2. **[STALE]** fix/audit-security: fix/audit-security 210s commitsiz (idle)
3. **[STALE]** verify/gwv2-all-lanes: verify/gwv2-all-lanes 326s commitsiz (idle)
4. **[STALE]** fix/binary-architecture-calibration: fix/binary-architecture-calibration 314s commitsiz (idle)
5. **[STALE]** claude/cool-cohen-b245ee: claude/cool-cohen-b245ee 240s commitsiz (idle)
6. **[STALE]** claude/determined-bartik-0090ba: claude/determined-bartik-0090ba 214s commitsiz (idle)
7. **[STALE]** claude/loving-varahamihira-77d4a9: claude/loving-varahamihira-77d4a9 372s commitsiz (idle)
8. **[STALE]** claude/naughty-kowalevski-2ccc35: claude/naughty-kowalevski-2ccc35 327s commitsiz (idle)
9. **[STALE]** (detached): (detached) 240s commitsiz (idle)

## Optimal working-prompt (seçili eyleme hazır)
# OLLAMAS — OPTIMAL WORKING PROMPT (self-optimizing, portable)

> Bu blok nereye yapıştırılırsa orada ollamas için EN-VERİMLİ seçimle çalışmaya başlar.
> `optimize.ts` üretti — benchmark-driven, deterministik. Bench/calibration değişince seçim otomatik güncellenir.

<context>
Donanım: Apple M4 Max · 52GB unified · 16 core · arm64.
Proje: ollamas (yerel MCP gateway + tools-as-SaaS). Çalışma prensipleri: choke-point tek-dispatch, TDD, evidence-first, no-vibe-code, zero-dep, correctness>hız.
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
