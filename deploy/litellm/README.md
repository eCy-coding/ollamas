# LiteLLM HTTP backend (ollamas v1.7)

[LiteLLM](https://github.com/BerriAI/litellm) (50.9k★, MIT) is an OpenAI-compatible proxy
fronting 100+ providers (Ollama, OpenAI, Anthropic, …) with per-key budgets/quotas/cost
tracking. ollamas consumes it through the **existing `custom-openai` provider** — no core
code, no Python dependency bundled. LiteLLM runs as a separate process.

## Why integrate vs. re-build

ollamas' choke-point (`server/providers.ts` → `custom-openai` case) already POSTs to any
OpenAI-compatible `/chat/completions`. Pointing it at LiteLLM unlocks multi-provider
routing + budgets for free, instead of re-implementing a router. This is the no-new-vibe-code
rule: adopt proven working code, wire it through the seam.

## Run

```bash
pip install 'litellm[proxy]'
litellm --config deploy/litellm/litellm.config.yaml --port 4000
# health check
curl -s http://localhost:4000/v1/models -H "Authorization: Bearer sk-ollamas-litellm-local"
```

## Wire ollamas → LiteLLM (one-time)

Set two keys in the ollamas key store (encrypted via `db.encrypt`):

| key | value |
|---|---|
| `custom-openai-endpoint` | `http://localhost:4000/v1` (stored raw) |
| `custom-openai` | `sk-ollamas-litellm-local` (the `master_key` in the config) |

Then select provider `custom-openai` and a `model_name` from the config (e.g. `local-qwen`).
ollamas tags responses `source: "cloud:custom-openai"` and records tok/s in `usage_events`.

## Contract test

`tests/litellm-provider.e2e.test.ts` mirrors `tests/ukp-upstream.e2e.test.ts`: it routes one
generate through `ProviderRouter` and asserts the response came from the proxy. It **skips
cleanly** when no proxy is reachable, so CI stays green.

```bash
# start the proxy first (above), then:
RUN_LIVE_E2E=1 LITELLM_BASE_URL=http://localhost:4000/v1 \
  LITELLM_KEY=sk-ollamas-litellm-local LITELLM_MODEL=local-qwen \
  npx vitest run tests/litellm-provider.e2e.test.ts
```
