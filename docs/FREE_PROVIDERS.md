# Free-Tier Cloud AI Providers — Key Acquisition Guide

ollamas routes across local Ollama models **plus** free-tier cloud APIs. Every provider
below ships a genuinely free API key (no credit card unless noted). Drop the key into
`.env` (or add it via the KeyVault UI / `POST /api/keys/add`) — the provider activates on
the next request; without a key it stays silently skipped (hasKey gate). Multiple keys
rotate automatically: `NAME`, `NAME_1..9`, or comma-separated `NAMES`.

Single source of truth for limits/models: `server/provider-catalog.ts`. Env overrides:
`KEY_LIMIT_<PROVIDER>_PERMIN/_PERDAY`.

| Provider | Signup | Env key | Free tier (Jul 2026) | Default model | Notes |
|----------|--------|---------|----------------------|---------------|-------|
| Groq | console.groq.com | `GROQ_API_KEY` | 30 rpm · 1K rpd · ~500K tok/day | llama-3.3-70b-versatile | Fastest; no training on prompts |
| Cerebras | cloud.cerebras.ai | `CEREBRAS_API_KEY` | ~1M tok/day | gpt-oss-120b | ⚠️ 8K context cap on free — router respects it |
| z.ai (Zhipu GLM) | z.ai/model-api | `ZAI_API_KEY` | ~1 concurrent, generous | glm-4.7-flash | Best free coding model, 200K ctx |
| SambaNova | cloud.sambanova.ai | `SAMBANOVA_API_KEY` | 10–30 rpm | Meta-Llama-3.3-70B-Instruct | 405B-class also free |
| NVIDIA NIM | build.nvidia.com | `NVIDIA_API_KEY` | ~40 rpm, 1K credits | meta/llama-3.3-70b-instruct | 100+ models |
| GitHub Models | github.com/marketplace/models | `GITHUB_MODELS_TOKEN` | 10 rpm · 50 rpd | openai/gpt-4o-mini | PAT with `models:read`; small quota |
| Cloudflare | dash.cloudflare.com → Workers AI | `CLOUDFLARE_API_TOKEN` **+** `CLOUDFLARE_ACCOUNT_ID` | 10K neurons/day | @cf/meta/llama-3.3-70b-instruct-fp8-fast | Both vars required |
| Mistral | console.mistral.ai/api-keys | `MISTRAL_API_KEY` | ~1B tok/mo (Experiment) | mistral-small-latest | ⚠️ flagged trainsOnData:true until terms verified — privateMode excludes it |

Already integrated before this catalog: `gemini` (AI Studio), `openrouter` (`:free`
models), `openai`, `anthropic`, `ollama-cloud`.

## Privacy (sovereign mode)

`trainsOnData` per provider is surfaced in `/api/keys/pool` and the SSE `cloudProviders`
payload. **Gemini's free tier trains on your prompts** — send `privateMode: true` in
`/api/generate` / `/api/agent/chat` and the chain routes around every training provider
(local tiers always remain). Mistral's free tier requires a training opt-in and Cohere's
trial forbids commercial use — both were deliberately left OUT of the catalog.

## Zero-manual connection (key-doctor)

`node scripts/key-doctor.mjs` scans this machine for candidate keys (process env + .env,
macOS Keychain known service names, `gh` CLI token → GitHub Models), validates each with
one real call, and reports what connecting it unlocks (capabilities → council roles).
`--connect` saves validated keys to the encrypted vault; `--fix` also runs
`gh auth refresh -s models:read` interactively when needed. The server repeats an
env-only silent scan at every boot — dropping a key into `.env` connects it on the next
restart with zero clicks. Endpoint: `POST /api/keys/doctor` (dryRun defaults true;
report is fully masked). Autopilot-step integration deferred (orchestration WIP) — the
boot scan covers the always-on path.

## Other modalities (same $0 keys)

- **Speech-to-text**: `POST /api/ai/transcribe?filename=a.wav` (raw audio body, ≤25MB) →
  Groq Whisper-large-v3, ~2,000 req/day on the SAME `GROQ_API_KEY`. No key → honest 503.
- **Embeddings (RAG)**: pin ONE provider per index via `EMBED_PROVIDER=voyage|jina|gemini|cloudflare`
  (`VOYAGE_API_KEY` 200M free tokens + rerankers; `JINA_API_KEY` 10M; gemini/cloudflare reuse
  their chat keys). Unset → local ollama nomic. Never rotate per-call — dims are index-bound.
- **Web search**: `TAVILY_API_KEY` (1,000 credits/month recurring) makes Tavily the primary
  engine for the agent's web_search tool; DuckDuckGo scrape stays the keyless fallback.
- **Fleet/council seats**: `provider::model` entries (e.g. `groq::llama-3.3-70b-versatile`)
  activate automatically once the key is live.

## Verification

```bash
# candidate key (before saving):
curl -s localhost:3000/api/keys/test -H 'Content-Type: application/json' \
  -d '{"provider":"groq","key":"gsk_..."}'

# all configured providers, one real completion each:
LIVE_PROVIDERS=1 npx vitest run tests/providers-live.test.ts
```

429s honor the provider's `Retry-After` for key cooldown; daily budgets persist across
restarts (boundary-aware: Gemini resets midnight Pacific, GitHub/Cloudflare UTC).
