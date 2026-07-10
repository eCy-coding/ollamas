> **canonical: `planlama/16-VERSIYON-YOLHARITASI.md`** — yürütme sırası (V1→V10). Bu dosya teknik-borç kaynağı (T-items).

# ollamas vNext — council roadmap (evidence-only, single-answer)

Produced by a 3-lens council (reliability / persistence / performance) under a strict mandate:
every item cites hard evidence (`file:line` / verifiable global fact / measured number), exactly
ONE correct fix, honest "no problem" where evidence is absent. No speculation.

> Note: the opensource-loop is also executing vNext (commit `51bd57b` "vNEXT A+B": provider-abort
> + idempotency). Coordinate — do not duplicate/revert. `gemini-cli` is in the chain BY DESIGN
> (`8bb08dc` keyless OAuth fallback) → T1.1 must GATE it, not remove it.

## Phase 1 — inference-engine correctness (XS–S)
- **T1.4 [P1] ✅ DONE (this lane):** `resolveDefaultModel` (`ai.ts`) returned `models[0]` = raw `/api/tags` order → could pick a 70B → **0 tok/s** on `MAX_LOADED_MODELS=1`, vs champion qwen3:8b **82 tok/s**. Fixed: prefer `MAC_MODEL_CHAMPION` when installed.
- **T1.1 [R1]** `getFallbackChain` (`providers.ts:397`) injects `gemini-cli` into `defaults` for ALL initials → non-gemini fallthrough pays up to the 30s SIGKILL (`gemini-cli.ts:97`); `geminiCliAvailable()` (`:126`) not consulted. **Fix:** GATE the in-chain gemini-cli case behind the cached availability probe (keep the fallback, kill the stall). **XS.**
- **T1.2 [R2]** 90s dispatch budget (`server.ts:570`) unreachable — 30s hardcoded `child.kill` (`gemini-cli.ts:97`). **Fix:** drop the hardcoded killTimer; rely on the caller `signal` (already wired `:93-94`). **XS.**
- **T1.3 [R3]** `buildSignal` 300s hardcode (`providers.ts:227`). **Fix:** `buildSignal(callerSignal?, timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS)||300000)`. **XS.**

## Phase 2 — routing efficiency (S–M)
- **T2.1 [R4]** 429 cooldown fixed 6h (`providers.ts:312`); Gemini RPD resets **midnight Pacific** (ai.google.dev/gemini-api/docs/rate-limits). **Fix:** daily-quota 429 → cool until next `America/Los_Angeles` midnight (RPM/TPM keep 60s). **S.**
- **T2.2 [P2]** Static chain; `latencyCache` (`providers.ts:299`) write-only, never reorders (measured 27× spread: gemini 1.23s vs gemini-cli 33s via `scripts/provider-bench.mjs`). **Fix:** sort the non-`front` tail by `getLatency()` asc (fresh <300s), keep gemini-family adjacency. **M.**
- **T2.3 [P3, optional]** Council loop sequential — correct for ollama (Mac), but cloud members (gemini/gemini-cli) needlessly interleaved (`server.ts:550`). **Fix:** hoist cloud members to a `Promise.all` lane. **M.**

## Phase 3 — persistence / multi-replica (M–L; deploy-critical, not hit on darwin)
- **T3.1 [S1]** Cloud master-key reborn every boot (`db.ts:108-128`, `isCloud` + no `MISSION_CONTROL_DATA_DIR` on Cloud Run → in-image `randomBytes(32)`) → existing Stripe/GitHub-App/provider ciphertext fails auth, `decrypt` returns `""` (`:187-189`) = silent billing/auth outage. **Fix:** load the 32-byte key from GCP Secret Manager at boot; fail-closed if absent on `isCloud`. **M.**
- **T3.2 [S2]** `db.ts` config (`keys`/`notify`/`securityLog`) is single-process full-file JSON (`:151-153`) + node-local `masterKey` + in-memory fallbacks (rate-limit buckets, `providers.ts:418` keyCooldown, `orchestrator.ts:16` JOB_STORE) → NOT multi-replica (SaaS OAuth/billing IS, on pg/Redis). **Fix:** migrate secret-bearing config to the `store` adapter (Postgres) + key from Secret Manager. **L.**

## NOT problems (council honest verdict — no work)
- **Vault AES-256-GCM:** no weakness (12-byte IV fresh per call `db.ts:161`, `authTagLength:16` pinned `:163,182`, short-tag rejected `:181` → Node #52327 closed).
- **Council Mac serialization:** correct — `MAX_LOADED_MODELS=1`; concurrent loads thrash → 0 tok/s.
- **Cockpit SSE:** already optimized — probes throttled ~6s (`server.ts:472`), binaries/pool cached (`:445-446`), gemini-cli probe 8s-TTL-cached.
- **Runtime regression:** none with a number → "no idea (no evidence)".
