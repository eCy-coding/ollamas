# $0 / cömert-ücretsiz servis kaydı (harness entegre)

Harness'in kullandığı sıfır-maliyet servisler. 🔑 = operatör API-key girer (Claude giremez).

## MCP serverları (.mcp.json — auto-onay: enabledMcpjsonServers)
| server | iş | $0 | auth |
|---|---|---|---|
| `ollamas` | kendi server (mcp__ollamas__*) | lokal | yok |
| `context7` | güncel library/paket docs (mcp__context7__*) | free, 429'da key opsiyonel | yok |
| `deepwiki` | GitHub repo derin-wiki (adoption-research) | tam ücretsiz | yok |

Restart sonrası: `mcp__context7__*`, `mcp__deepwiki__*` erişilebilir.

## Free CLI (permissions.allow — read-only/analysis, lokal kurulu)
`gh search/pr-view/issue-list/run-list`, `semgrep`, `trivy fs/repo`, `gitleaks`, `jq`, `fd`, `deno check`, `bun test`, `rg`, `grep`, `find`, `ls`.

### Auth DURUM (2026-06-26) — operatör ek-iş gerekmiyor
- ✅ **gh**: auth'lu (eCy-coding, scopes: repo/gist/read:org). Hazır.
- ✅ **semgrep / trivy / gitleaks**: keyless (lokal, API yok). Hazır.
- Slash komutlar: `/security-scan` (semgrep+trivy+gitleaks), `/deps-audit` (trivy+npm audit), `/lib-docs` (context7), `/repo-explain` (deepwiki). Restart sonrası MCP komutları canlı.

## Side-effectful CLI (permissions.ask — insan onayı)
`gh pr create/merge/release`, `vercel`, `wrangler deploy`, `supabase db push`, `git commit/push`, `npm publish`.

## Free inference (agent fleet — $0, Mac≈0 cloud)
Key pool DURUM (canlı): **OpenRouter ×3 LIVE, Ollama Cloud ×3 LIVE, Gemini 0 LIVE (düştü)**.
| sıra | servis | $0/gün | şimdi | auth |
|---|---|---|---|---|
| 1 | **Ollama Cloud** | hesap kotası | ✅ birincil cloud (qwen3-coder:480b-cloud) | var |
| 2 | **OpenRouter :free** | ~50 RPD (<$10) | ✅ Qwen3-Coder-480B:free, DeepSeek-R1:free | var |
| 3 | Gemini free | — | ⚠️ key düştü → yenilenince geri al (gemini-2.5-pro winner'dı) | 🔑 |
| 4 | Groq | 1000 RPD, <200ms | düşük-gecikme loop için EN İYİ | 🔑 ekle |
| 5 | Cerebras | 1M tok/gün, 5 RPM | büyük tek-shot (audit synth) | 🔑 ekle |

**Routing notu (scripts-lane patch):** combo-bench/agent-dispatch default'u şu an `ollama-cloud` + `openrouter:free` olmalı (gemini down). gemini geri gelince → gemini-2.5-pro (ölçülü winner). Patch: scripts/NOTE-model-efficiency'e bağlı.

## Free CI / security (.github/workflows/)
- `harness-test.yml` — settings-schema + hook golden suite.
- `claude-review.yml` — PR review (🔑 ANTHROPIC_API_KEY secret gerekli).
- `security.yml` — Semgrep + Trivy + Gitleaks ($0, secret yok). **CodeQL**: public repo'da Settings→Security→default setup ile ücretsiz aç.

## Free deploy/edge/DB (kurulu CLI, kullanıma hazır)
Cloudflare (`wrangler`, Colab-tunnel'da aktif), Vercel (hobby), Supabase (free + MCP session-level bağlı). Hepsi `ask` izninde.

## 🔑 OPERATÖR — opsiyonel hız için free-key ekle (.env / keychain)
```bash
# Groq (1000 RPD, ultra-fast):    https://console.groq.com/keys
# Cerebras (1M tok/gün):          https://cloud.cerebras.ai
# GitHub PAT (gh + GH Models):    gh auth login
```
Eklenince fleet 2-3x hızlanır. Claude key giremez — bu yüzden operatör.
