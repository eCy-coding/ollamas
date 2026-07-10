# Testing — suite, gates & skip map

The default `vitest run` suite is FRESH-green with no live infrastructure. Tests that need
real infra (a running server, ollama, a provider API key, a spawned MCP upstream, sudo, or a
slow perf budget) are **gated** — they `skipIf(...)` off an env var / capability probe and no-op
in the default run instead of failing CI. Every gated call-site carries a `// gated: <ENV> — <reason>`
comment (M-014); this file is the index.

## How to run

| Goal | Command |
| --- | --- |
| Fast suite (default, no live infra) | `npm test` (`vitest run`) |
| Perf cases | `PERF=1 vitest run` |
| Live e2e (opt-in bundle) | `RUN_LIVE_E2E=1 vitest run tests/<file>` |
| Playwright web e2e | `npm run test:e2e` |

## Skip map (gated call-sites)

Each row is a `skipIf`/`ctx.skip` site that stays skipped in the default run. "How to enable"
lists the env var(s) / capability that flip it on.

| File · line-ish | Gate (env / probe) | Why it's gated · how to run |
| --- | --- | --- |
| `tests/cli-keychain-live.test.ts` | `OLLAMAS_LIVE_KEYCHAIN=1` + darwin | Round-trips a REAL macOS Keychain TEST item; opt-in so CI never triggers a keychain prompt. |
| `tests/mac-power.e2e.test.ts` | `RUN_LIVE_E2E=1` + darwin | Runs the real (sudo) `powermetrics` sampler; no-op off-darwin. |
| `tests/rag.e2e.test.ts` | `RUN_LIVE_E2E=1` | Needs a running ollama for real embeddings (the fake-embedder path is always tested). |
| `tests/providers-live.test.ts` (describe) | `LIVE_PROVIDERS=1` | Hits real free-tier provider HTTP APIs. |
| `tests/providers-live.test.ts` (per-entry) | `<entry.envKey>` present (+`CLOUDFLARE_ACCOUNT_ID`) | Each provider case needs its real API key. |
| `tests/bench-tool.e2e.test.ts` | `RUN_LIVE_E2E=1` + llama-bench binary + `LLAMA_BENCH_MODEL` | Runs the real `llama-bench`. |
| `tests/truth-oracle.test.ts` (×2) | `PERF=1` | Heavy adversarial-UNSAT + CDCL headline perf cases; slow, excluded from the fast suite. |
| `tests/litellm-provider.e2e.test.ts` (skipIf) | `RUN_LIVE_E2E=1` | Needs a running LiteLLM proxy on `LITELLM_BASE_URL`. |
| `tests/litellm-provider.e2e.test.ts` (ctx.skip) | runtime | Opted-in but proxy unreachable → skip, don't fail CI. |
| `tests/ukp-upstream.e2e.test.ts` (×6) | uk-pipeline checkout present (`fs.existsSync(UKP)`) | Needs the local uk-pipeline repo to spawn the upstream MCP server. |
| `tests/fs-upstream.e2e.test.ts` | `RUN_LIVE_E2E=1` | Connects the real `@modelcontextprotocol/server-filesystem` via npx (network). |
| `tests/reference-upstreams.e2e.test.ts` (×2) | `RUN_LIVE_E2E=1` | Connects the real `@modelcontextprotocol/server-everything` via npx (network). |
| `tests/ClusterE2ELive.test.ts` | `RUN_LIVE_E2E=1` | Needs the server up on `TEST_BASE_URL` (default `:3000`). |
| `tests/dispatch.e2e.test.ts` (ctx.skip) | runtime | Mac server + live remote host must be reachable; the pure test carries the deterministic contract. |

**Total gated call-sites: 21** (19 `skipIf` + 2 runtime `ctx.skip`). Keep this table in sync
when adding or removing a gated test — the `// gated:` comment at the call-site is the source of truth.

## Boot harness (M-050)

In-process HTTP route tests import the exported `app` from `server.ts` under
`OLLAMAS_NO_AUTOBOOT=1` — top-level routes/middleware register at module load, so a test exercises
real handlers without binding a port or booting vite/the store. Routes that need coverage are
registered at module top-level (e.g. `/api/health`, `/api/pipeline`); `createAdminGuard()` is a
module-level factory so its throttle/timing-safe middleware is testable in isolation. See
`tests/pipeline-validate.test.ts`, `tests/admin-guard.test.ts`, `tests/routes-hardening.test.ts`.
