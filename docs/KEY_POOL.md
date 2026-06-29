# Sustainable API-key pool

Multi-key rotation + proactive quota awareness + guided provisioning — minimum manual.
Applies to all keyed providers: **gemini, openai, anthropic, openrouter**.

## Lifecycle
```
load keys (env or vault) ─▶ least-loaded auto-rotate ─▶ key nears its limit
        ▲                                                      │
        │                                              ALL live keys near limit?
   paste + Save                                                │ yes
   (joins the pool)                                            ▼
        ▲                                          NOTIFY (UI banner + toast + desktop)
        └──────────── operator: open key page, log into NEXT account, create + paste
```

## How it works
- **Per-key usage** (`server/key-usage.ts`): rolling per-minute + per-day counters, keyed by a
  non-reversible `keyId = sha256(key) prefix` (the raw key is NEVER stored/logged/surfaced).
- **Limits** (`server/key-limits.ts`): per-provider free-tier defaults (gemini 20/min · 1000/day),
  env-overridable `KEY_LIMIT_<PROVIDER>_PERMIN/_PERDAY`. `0 = unlimited`.
- **Least-loaded selection** (`ProviderRouter.getDecryptedKey`): among LIVE (non-cooled) keys, the
  one with the most headroom is used → load spreads, the next key serves BEFORE a 429 (silent
  auto-rotate). The reactive 429/401 cooldown (6h quota / 24h auth) stays the backstop.
- **Saturation** (`ProviderRouter.poolSaturation`): `allApproaching` = every live key ≥ 80% → the
  pool can't absorb more → the alert fires (this is the ONLY time the operator is interrupted).

## Add keys
- **Env (batch):** `GEMINI_API_KEY`, `GEMINI_API_KEY_1..9`, `GEMINI_API_KEYS=k1,k2` (same for
  `OPENAI_*`, `ANTHROPIC_*`, `OPENROUTER_*`). Joins the pool on boot.
- **Vault (guided, UI):** Key Vault panel → **Key ↗** opens the provider key page
  (gemini → AI Studio) → log into the next account, create a key, paste it, **Save**. With a
  primary key already set, Save **grows the pool** (`POST /api/keys/add`, AES-256-GCM at rest).
- **gemini-cli binary:** the provider passes the best pooled `GEMINI_API_KEY` into the binary
  spawn → per-key 1000/day × N instead of the shared OAuth free tier.

## API
- `GET /api/keys/pool` → `{ pool: { <provider>: {total, live, worstPct, allApproaching} }, alerts:[…] }`
- `POST /api/keys/add {provider, key}` → append to the encrypted pool → `{success, poolSize}`
- `POST /api/keys/test {provider, key}` → verify a key is live before committing.

## Security
Raw keys never leave the server unencrypted; the UI/SSE/logs only ever see a `keyId` hash prefix +
a last-4 mask. The vault is AES-256-GCM at rest.
