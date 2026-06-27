# ollamas — gerekli/gereksiz · çalışan/çalışmayan tespit (2026-06-27)

e2e baseline: server **live** · tsc **0 hata** · vitest **864 pass**. Yöntem: knip + depcheck + import-grep çapraz-doğrulama. **Silme YOK** — tespit + risk-sıralı öneri.

## 🟢 NECESSARY + WORKING (load-bearing — dokunma)
`cli/**` (zero-dep CLI) · `server.ts`+`server/**` (/api+/mcp) · `src/**`+`public/embed.js` (frontend) · `tests/**` (864) · `bin/mcp-stdio.ts`+`dist/mcp-stdio.cjs` (package.json bin) · `orchestration/bin/**` (autopilot) · `.claude/**` (harness).
**knip "unused" ama CANLI (yanlış-pozitif — dinamik entry-point):** `.claude/hooks/*.mjs` (settings.json kayıtlı) · `orchestration/bin/*.ts` (tsx-spawn) · `scripts/*.mjs` (npm scripts) · `bin/host-bridge/**` (POSIX spawn) · `public/embed.js` (shortcuts/rag).

## 🔴 NON-WORKING / BROKEN
**YOK.** 0 stub/unimplemented/XXX (cli/server/scripts/orchestration). TODO/FIXME yalnız `orchestration/bin/dod.ts`+`lib/dod.ts` (kozmetik). Baseline yeşil.

## 🟠 UNNECESSARY — silme adayları (güven sırası)
| # | yol | sınıf | kanıt | risk | aksiyon |
|---|---|---|---|---|---|
| 1 | `combo-bench.err` | scratch (ignore değil) | benim stderr leftover'ım | YOK | **silindi + *.err gitignore** |
| 2 | `.sync/` (48K) | scratch (ignore değil) | untracked sync-cache | YOK | **gitignore** |
| 3 | `audit-out/` (40K) | generated (ignore değil) | audit-pipeline çıktısı | YOK | **gitignore** |
| 4 | `.claude/worktrees/` (20M) | scratch (ignored ✅) | git-temiz, repo şişiren | YOK | periyodik `rm -rf` (operatör) |
| 5 | `server/tools/search_browser.ts` | dead code | import=0, tool-registry'de yok | DÜŞÜK | onay+runtime-doğrula → sil (server lane) |
| 6 | `client/ai-client.ts` | orphan | import=0 | DÜŞÜK | onay → sil |
| 7 | `test_orchestration.ts` (kök) | orphan test-scratch | ref=0, vitest-glob dışı | DÜŞÜK | onay → sil |
| 8 | `scripts/{master_e2e_workflow,e2e_verify}.ts` | orphan | ref=0, package.json'da yok | ORTA | CI/launchd kontrol → onay |

## 📦 Unused deps (depcheck — package.json temizliği, server lane)
- `commander` → **zero-dep CLI ihlali** (parseArgs var); import edilmiyorsa düş.
- `motion`, `@firebase/eslint-plugin-security-rules` (runtime kullanılmıyor) · devDep: `autoprefixer`/`tailwindcss`/`@size-limit/file` (kullanım doğrula).

## Onay-bekleyen (DESTRUCTIVE/cross-lane — yapılmadı)
#5-8 kod-dosya silme + dep temizliği. Her biri silmeden önce runtime/dinamik-yükleme tekrar grep-doğrulanmalı (knip false-pos riski). git-history-rewrite YOK.
