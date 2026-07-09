# CERTIFY — v1.25.4 certification snapshot

Date: 2026-07-09 22:29 +03 · Node v24.16.0 · branch `feat/key-autonomy` · HEAD `b9d11df`

FRESH run, verbatim output. No force-green: real results recorded as-is.

## 1. Core gate

| command | exit | count | note |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | 0 errors | GREEN — clean, no type errors |
| `npm test` (root `vitest.config.ts`, all 4 projects: node/jsdom/scripts/orchestra) | 0 | Test Files 236 passed \| 5 skipped (241) · Tests 1900 passed \| 22 skipped (1922) | GREEN — 0 failed. Duration 6.70s. Skips = live/PERF-gated (default gates unset) |

Verbatim vitest summary (`npm test`):
```
 Test Files  236 passed | 5 skipped (241)
      Tests  1900 passed | 22 skipped (1922)
   Duration  6.70s (transform 5.59s, setup 2.91s, import 13.61s, tests 20.25s, environment 7.41s)
```

No RED. The 22 skipped tests are env-gated live/PERF suites that never run under default `npm test` (see §2). PERF-gated tests confirmed runnable+green out-of-band below.

## 2. Live / gated E2E matrix (13 rows)

Gates are unset under default `npm test` → those rows show SKIPPED. Rows whose gate is safe to set here (PERF — pure computation, no network/sudo/keychain) were RUN and their real result recorded.

| # | test | gate env | runnable now | result |
|---|---|---|---|---|
| 1 | tests/cli-keychain-live.test.ts (`describe.skipIf(!live)`) | `OLLAMAS_LIVE_KEYCHAIN=1` (+darwin) | gate unset | SKIPPED (gate OLLAMAS_LIVE_KEYCHAIN unset; not run — would trigger macOS keychain prompt) |
| 2 | tests/mac-power.e2e.test.ts | `RUN_LIVE_E2E=1` (+darwin +sudo) | gate unset | SKIPPED (gate RUN_LIVE_E2E unset; needs sudo powermetrics) |
| 3 | tests/rag.e2e.test.ts | `RUN_LIVE_E2E=1` | gate unset | SKIPPED (gate RUN_LIVE_E2E unset) |
| 4 | tests/providers-live.test.ts (`describe.skipIf(!LIVE)`) | `LIVE_PROVIDERS=1` (+API keys) | gate unset | SKIPPED (gate LIVE_PROVIDERS unset; needs live provider keys) |
| 5 | tests/bench-tool.e2e.test.ts | `RUN_LIVE_E2E=1` (+binary +MODEL) | gate unset | SKIPPED (gate RUN_LIVE_E2E unset; needs ollamas binary + model) |
| 6 | tests/truth-oracle.test.ts — "ROBUSTLUK: adversaryel UNSAT → brute fallback" | `PERF` | GATE SET (run) | PASS (PERF=1 run, deterministic) |
| 7 | tests/truth-oracle.test.ts — "HEADLINE: ⋁(Xᵢ∧¬Xᵢ)@25 CDCL ANINDA" | `PERF` | GATE SET (run) | PASS (PERF=1 run, deterministic) |
| 8 | tests/litellm-provider.e2e.test.ts (`RUN_LIVE`) | `RUN_LIVE_E2E=1` | gate unset | SKIPPED (gate RUN_LIVE_E2E unset) |
| 9 | tests/ukp-upstream.e2e.test.ts (5 tests) | `HAVE_UKP` | gate unset | SKIPPED (gate HAVE_UKP unset; needs uk-pipeline upstream) |
| 10 | tests/ClusterE2ELive.test.ts (`skipIf(!live)`) | `RUN_LIVE_E2E=1` | gate unset | SKIPPED (gate RUN_LIVE_E2E unset; needs live cluster mesh) |
| 11 | tests/fs-upstream.e2e.test.ts | `RUN_LIVE_E2E=1` | gate unset | SKIPPED (gate RUN_LIVE_E2E unset) |
| 12 | tests/reference-upstreams.e2e.test.ts (2 tests) | `RUN_LIVE_E2E=1` | gate unset | SKIPPED (gate RUN_LIVE_E2E unset) |
| 13 | scripts/tests/bridge-e2e.test.ts (`skipIf(!BRIDGE_E2E)`) | `BRIDGE_E2E` | gate unset | SKIPPED (gate BRIDGE_E2E unset; needs real host bridge) |

Summary: 2 runnable / 11 skipped. Both runnable (PERF) rows GREEN.

Verbatim PERF-gated run (`PERF=1 npx vitest run tests/truth-oracle.test.ts`):
```
 Test Files  1 passed (1)
      Tests  63 passed (63)
```
(vs 61 under default `npm test` where the 2 PERF tests skip → confirms the 2 gated tests pass when enabled.)

## Verdict

GATE GREEN. tsc 0 errors, `npm test` 0 failed (1900 passed / 22 gated-skip / exit 0), PERF-gated suite passes when enabled. No RED, no force-green.
