# Harness CLI registry (e2e, kritiklik-sıralı)

Harness'in gereksindiği CLI'lar — tier (kritiklik) → kullanan bileşen → permission → install → $0/auth.
Hepsi 2026-06-27 itibarıyla kurulu + ücretsiz. perm: **allow**=otomatik, **ask**=onay, **deny**=yasak, **—**=Bash değil.

## T0 — CORE (bunlarsız harness ÇALIŞMAZ)
| CLI | kullanan | perm | install | not |
|---|---|---|---|---|
| node | her hook/script/agent | allow | mise lts | runtime |
| npm | gate (build/test/lint), scripts | allow | mise | — |
| npx | tsc/vitest fallback | allow | mise | — |
| git | gate, commit, statusline, hooks | allow(read)/ask(commit/push)/deny(force) | brew | — |
| tsx | role-hook/model-hook/autopilot (TS hook runner) | — (node_modules/.bin) | dep | TS hook'ları çalıştırır |
| tsc | lint + typecheck (gate) | allow `npx tsc --noEmit` | dep | lint script = tsc |
| mise | node sürüm yönetimi | — | brew | PATH kökü |

## T1 — GATE (pre-commit + CI, $0)
| CLI | kullanan | perm | install |
|---|---|---|---|
| vitest | test (864/0) | allow `npm run test` | dep (npx) |
| vite + esbuild | build | — (npm run build) | dep |
| semgrep | /security-scan, security.yml (SAST) | allow | brew 1.157 |
| trivy | /security-scan, /deps-audit (vuln/misconfig) | allow `trivy fs/repo` | brew 0.69 |
| gitleaks | /security-scan (secrets) | allow | brew 8.30 |

## T2 — ARAMA / DOSYA (günlük, allow)
| CLI | kullanan | perm |
|---|---|---|
| rg | kod arama | allow |
| fd | dosya bulma | allow |
| jq | JSON parse (hook/script) | allow |
| grep · find · ls | temel | allow |

## T3 — VCS / CI
| CLI | kullanan | perm | auth |
|---|---|---|---|
| gh | PR/issue/run, CI; /repo-explain fallback | allow(search/view/list) · ask(pr-create/merge/release) | ✅ eCy-coding (repo/gist/read:org) |

## T4 — LLM / LSP (agent fleet + tanı)
| CLI | kullanan | perm | not |
|---|---|---|---|
| ollama | local model (qwen3:8b), agent-dispatch | — (HTTP :11434) | RAM-bound; cloud-first tercih |
| typescript-language-server | inline TS diagnostics | — (.lsp.json) | npm -g kurulu |

## T5 — DEPLOY / EDGE (ask, outward — insan onayı)
| CLI | kullanan | perm | not |
|---|---|---|---|
| vercel | deploy (hobby $0) | ask | outward = Emre kararı |
| wrangler | Cloudflare Workers/Pages | ask | cömert free |
| supabase | DB/edge (free + MCP) | ask `db push` |
| cloudflared | Colab-T4 offload tunnel | ask* | *coverage açığı — eklenebilir |
| docker | colab-local-runtime, container | ask* | *coverage açığı |

## T6 — CLOUD (ask, nadir)
| CLI | perm | not |
|---|---|---|
| gcloud | ask* | nadir; gerekince |
| aws | ask* | nadir |

## Coverage — KAPANDI (2026-06-27)
- `cloudflared`, `docker`, `gcloud`, `aws` → `permissions.ask`'a eklendi (merge-settings union).
- `npx tsx` → `permissions.allow`'a eklendi (TS hook/script runner).
- Apply re-run sonrası canlı.

## Smoke-test (canlı kanıt, 2026-06-27)
Versiyon (26/26): node v24.16 · git 2.53 · tsc 5.8.3 · mise 2026.5 · semgrep 1.157 · trivy 0.69.1 · gitleaks 8.30 · rg 15.1 · fd 10.4 · jq 1.8 · vercel 54.6 · wrangler 4.93 · supabase 2.101 · cloudflared 2026.2 · docker 29.5 · gcloud 562 · aws 2.34 · tsls 5.3.
**Gerçek API/fonksiyonel:**
- gh → `gh api user` = **eCy-coding** (canlı auth ✓)
- ollama → `/api/tags` = **18 model** (canlı ✓)
- gitleaks → **578 commit tarandı, 5 leak bulundu** ⚠️ (git geçmişi — docs/örnek mi gerçek mi ayrı incele)
- jq → gerçek parse ✓ · trivy → cli/ misconfig clean ✓ · semgrep → cli/ 1 bulgu ✓
- gate → tsc 0 + vitest 864/0 (önceki tur)

## Özet
- **Zorunlu (T0-T1):** 12 CLI — hepsi kurulu + $0. Harness + gate bunlara dayanır.
- **Operasyonel (T2-T4):** arama + gh + LLM/LSP — hazır, auth tam (gh ✅).
- **Outward (T5-T6):** deploy/cloud — ask-tier (insan onayı), $0/free-tier.
- Auth gereken tek şey gh (✅ yapılmış). Geri kalanı keyless/local. Opsiyonel hız: Groq/Cerebras free-key (FREE-SERVICES.md).

## Eklenenler (add-cli)
| eklendi | CLI | tier | kullanım | rule |
|---|---|---|---|---|
| 2026-06-26 | shellcheck | allow | shell lint | `Bash(shellcheck:*)` |
| 2026-06-26 | yq | allow | YAML/JSON query | `Bash(yq:*)` |
| 2026-06-26 | shfmt | allow | shell format/lint | `Bash(shfmt:*)` |
| 2026-06-26 | hadolint | allow | Dockerfile lint | `Bash(hadolint:*)` |
| 2026-06-26 | hyperfine | allow | command benchmark | `Bash(hyperfine:*)` |
| 2026-06-26 | http | ask | httpie HTTP client (api test) | `Bash(http:*)` |
| 2026-06-26 | just | ask | task runner | `Bash(just:*)` |
| 2026-06-26 | watchexec | ask | run-on-change | `Bash(watchexec:*)` |

## Atlananlar (interaktif TUI — agent headless kullanamaz)
bat · delta · duf · procs · gum · glow · lazygit · lazydocker · btop · ncdu · eza · zoxide · fzf — TTY-only, harness'e eklenmedi (anlamsız + bloat). Kurulu-olmayan faydalılar (actionlint/scc/ast-grep/biome) → install önerisi, gerekince /add-cli.
| 2026-06-26 | shortcuts | ask | v6 Apple Shortcuts pack (run/list) | `Bash(shortcuts:*)` |
| 2026-06-26 | mandoc | allow | v13 man -Tlint | `Bash(mandoc:*)` |
| 2026-06-26 | hf | allow | HF model/adoption research | `Bash(hf:*)` |
| 2026-06-26 | depcheck | allow | zero-dep unused audit | `Bash(depcheck:*)` |
