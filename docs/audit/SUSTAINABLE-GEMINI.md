# Sustainable cloud Gemini — operator runbook

Cloud Gemini runs on a **rotating API-key pool** that self-heals daily. Benchmark-proven best path:
`gemini` (api-key pool) **1.23s** > `ollama-local` qwen3:8b 2.74s ($0) > `gemini-cli` (keyless) 33s.

## How it stays sustainable (no daily babysitting)
- **Pool + rotation** (`ProviderRouter`): N keys across N GCP projects. Free tier = **20 req/day per project** → N keys ≈ N×20/day. On a 429 a key is cooled and the next live key is used.
- **Daily reset:** Google resets per-project quota daily → the whole pool refreshes every day automatically. No re-provision needed for normal use.
- **Graceful fallback:** if the whole pool is cooled mid-day, requests fall to **$0 local qwen3:8b** (unlimited) — zero downtime.
- **Cockpit:** the CLOUD chip shows `gemini ✓ live/total` (honest pool liveness); KeyVault burn-meter mirrors it.

## Commands
- `npm run gemini:check` — pool health (`live/total · ~req left`); alerts (Slack/Discord) if dry. Exit 0 healthy / 2 dry.
- `npm run gemini:provision` — refill the pool (1 key per GCP project, idempotent — skips existing). Run only if keys are revoked or you add projects. Keys flow gcloud→vault, never printed.
- `npm run provider:bench` — re-rank the paths (which is fastest/most-reliable right now).

## Auto-monitor (optional, one-time activation)
```
cp scripts/com.ollamas.gemini-pool-check.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ollamas.gemini-pool-check.plist
```
Runs `gemini:check` every 4h (read-only) → pings you only when the pool is genuinely dry.

## Need more than ~N×20/day? — grow the pool (one command)
- **More projects (auto):** `npm run gemini:provision -- --new-projects 6` → creates 6 new GCP projects + a key in each → **+~120/day**. Preview first: add `--dry` (creates nothing). Caveat: GCP caps active projects (~12-30 default; beyond → a quota-increase request at console.cloud.google.com, Google-side). Some brand-new projects may require billing for certain APIs (the script reports per-project + continues).
- **Unlimited:** enable billing on one project (paid tier) — no quota wall.

> Why only Gemini? Free-tier quota is **per-project** (20/day) → N projects multiply it. OpenAI / Anthropic / OpenRouter enforce limits at the **account level** (not per key), so pooling their keys adds NO capacity — and none has a gcloud-style zero-bootstrap auto-provision. Gemini is the only provider where this works.

Creating projects/credentials/billing is the operator's action (classifier-gated for the agent), one command.
