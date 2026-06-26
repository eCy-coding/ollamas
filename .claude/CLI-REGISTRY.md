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

## Coverage açıkları (permission'da eksik — opsiyonel ekleme)
- `cloudflared`, `docker` → şu an hiçbir tier'da; Colab-offload kullanıyor → `permissions.ask`'a eklenebilir.
- `gcloud`, `aws` → nadir; gerekince `ask`.
- Düzeltme istenirse: merge-settings.mjs HARNESS.permissions.ask += bunlar (union otomatik katar).

## Özet
- **Zorunlu (T0-T1):** 12 CLI — hepsi kurulu + $0. Harness + gate bunlara dayanır.
- **Operasyonel (T2-T4):** arama + gh + LLM/LSP — hazır, auth tam (gh ✅).
- **Outward (T5-T6):** deploy/cloud — ask-tier (insan onayı), $0/free-tier.
- Auth gereken tek şey gh (✅ yapılmış). Geri kalanı keyless/local. Opsiyonel hız: Groq/Cerebras free-key (FREE-SERVICES.md).
