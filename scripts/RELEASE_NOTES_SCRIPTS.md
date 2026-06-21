# ollamas Scripts Lane — GA Release Notes (v10.0.0)

> Scope: ollamas **scripts domain** — host-execution & cross-device (macOS + iOS)
> delivery. Branch `feat/scripts-v1`. GA = production-mature: drift + crypto +
> shell regressions are caught in CI on a real macOS runner.

## What "GA" means here

- **Drift guard enforced** — `bin/host-bridge/drift-check.mjs` proves the 4 registration sources name the exact same tool set (inventory ↔ schema ↔ builders ↔ tool files) + every manifest entry file exists. CI fails on any drift.
- **Cryptographic parity anchored to an external reference** — HMAC-SHA256 is verified against RFC 4231 known-answer tests (the IETF cases also used by C2SP/wycheproof), across JS (`hmac.mjs`), the node drift test, and Swift CryptoKit. Not just self-consistency — correctness.
- **macOS CI** — `.github/workflows/scripts-ci.yml` runs the full gate on `macos-latest` (the real target platform) + `actionlint` on the workflows. Separate from the shared app `ci.yml` (no cross-lane collision).
- **Single choke-point preserved** — every host tool reaches the host only through `register-host-scripts.mjs` → `ToolRegistry.register` → `deps.execOnHost`. No second dispatch path.

## Version history (v1 → v10)

| v | Theme | Key delivery |
|---|-------|--------------|
| v1 | Foundation & Inventory | manifest skeleton |
| v2 | Script Test Harness | `hmac.mjs` single-source HMAC + 18 tests |
| v3 | iOS Bridge | Swift Package (OllamasKit + `ollamas-ios`) + cross-lang HMAC parity |
| v4 | Cross-Platform Bench | `bench-metrics.mjs` tok/s (adopt llm-benchmark MIT) + `--platform` |
| v5 | Registration Hooks | `registerHostScripts()` reconciler (canonical + has + OpenAI schema) |
| v6 | Hardening & Portability | shellcheck + shfmt + bats + portable snippets |
| v7 | Self-Healing | health→remediation map + `self_heal` (DRY default) + KeepAlive plist |
| v8 | Observability | JSONL seyir events + `seyir_stats` p50/p95 + SLO burn-rate |
| v9 | iOS Deepening | `OfflineQueue` (Codable persist + flush/retry) + queue CLI + Shortcuts automation |
| **v10** | **GA & Drift Guard** | standalone drift detector + RFC 4231 HMAC KAT parity + macOS CI + actionlint + portable operating prompt |

## Gate matrix (GA, fresh run on macOS)

| Gate | Command | v10 result |
|------|---------|-----------|
| Types | `npx tsc --noEmit` | 0 errors |
| Unit (JS) | `npx vitest run` | 174 pass / 1 skip |
| Shell | `make harden` (shellcheck + shfmt + bats) | 9 bats ok |
| Drift | `node bin/host-bridge/drift-check.mjs` | 17 tools aligned, exit 0 |
| Swift | `cd bin/ios-bridge && swift build && swift test` | 15 pass / 0 fail |
| Workflows | `actionlint` | clean (CI docker image) |

## Adoption ledger (working code/patterns; no vibe-coding)

| Source | License | Use |
|--------|---------|-----|
| `modelcontextprotocol/typescript-sdk` | MIT/Apache | registerTool contract |
| `colinhacks/zod` + `zod-to-json-schema` | MIT/ISC | arg validation → JSON schema |
| `bats-core`, `mvdan/sh` (shfmt), `koalaman/shellcheck` | MIT/BSD/GPL(tool) | shell gate |
| `pinojs/pino` | MIT | JSONL event pattern |
| `ralfebert/PersistentURLRequestQueue` | MIT (pattern) | iOS offline queue |
| `C2SP/wycheproof` + RFC 4231 | Apache-2.0 | HMAC-SHA256 known-answer vectors |
| `rhysd/actionlint` | MIT (tool) | workflow lint |

## Tagging

The product uses release-please for whole-repo versioning; this lane does **not**
push its own git tag (would clash with that flow). `inventory.json` `version: 10.0.0`
is the lane GA marker. An actual `git tag` is the operator's call.

## Next (v11, precomputed)

Scripts-as-SaaS metering — propagate the per-call realtime metering hook into the
host tools, aligned with the canonical `AGENTS.md` backlog.
