# COLAB_ROADMAP.md — ollamas Colab Koordinatör Lane

Worktree: `ollamas-colab-wt` · Branch: `feat/colab-v1`

| Versiyon | Kapsam | Durum |
|----------|--------|-------|
| **vC0** | Colab `google.colab.ai` façade (`server/ai.ts` + `/api/ai/*` + `client/ai-client.ts`) — feat/v1.11'de commit'lendi (8d6d52d), lane temeli | ✅ DONE |
| **vC1** | Detection harness (tsc+vitest+semgrep→Finding[]) + Gemini triage (adversarial verify) → `BUGFIX_REPORT.md` + **migration-drift crash fix** (gate'li, tek blocking) | ✅ DONE |
| vC2 | Gate'li auto-fix apply (worktree-izole verify-or-revert) → TÜM doğrulanmış bug'lar tek tek | ⬜ NEXT |
| vC3 | 0-manuel daemon + CI entegrasyonu (PR'a danger-tarzı yorum) | ⬜ |
| vC4 | Benchmark-driven local-engine selectBest (orchestration optimize entegrasyonu) | ⬜ |

## vC1 Phase'leri

- **P0** Lane kurulumu — worktree + façade carry + COLAB_AGENTS/ROADMAP ✅
- **P1** Gemini-yetenekli façade — `ai.ts` provider/engine seçimi + `pickEngine` ✅
- **P2** Detection harness — `bugfix/detect.ts` (tsc/vitest/semgrep → Finding[]) ✅
- **P3** Gemini triage + refute + rapor — `bugfix/triage.ts`, `BUGFIX_REPORT.md` ✅
- **P4** Migration-drift fix — `migrations.ts` v4 guarded ADD COLUMN + regresyon testi ✅
- **P5** Gate + verify + commit ✅

## ⚠️ Gemini key — tek manuel girdi (credential)
vC1 pipeline **Gemini-hazır** ama `config.json` vault'ta ve `GEMINI_API_KEY` env'de
key YOK → triage benchmark-best local fallback (`qwen3-coder:30b`) ile çalıştı (graceful).
Gemini'yi etkinleştirmek için (uyduramam, credential): `export GEMINI_API_KEY=...` veya
vault'a ekle. pickEngine key'i otomatik algılar.

## Doğrulanmış bug kuyruğu (vC1 raporundan beslenecek)
1. **[BLOCKING] migration-drift** `server/store/migrations.ts:100-111` — CREATE TABLE IF NOT EXISTS + index family_id, eski-şema tablosunda crash. → vC1 P4 fix.
2. (vC1 detection+triage çıktısı buraya — commander shell-inject, store `.rows[0]`, tool-interceptors circular-ref adayları doğrulanacak → vC2)
