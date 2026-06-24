# Changelog

## [1.23.0](https://github.com/eCy-coding/ollamas/compare/v1.22.1...v1.23.0) (2026-06-24)


### Features

* **agent:** calibrated ollamas sub-agent dispatcher + fix fallback model leak ([bea1a02](https://github.com/eCy-coding/ollamas/commit/bea1a0221faad9c28cffa7ba7f92e9d0e4d088cc))
* **agent:** role-aware model routing in agent-dispatch — consume measured MODEL_SELECTION ([b8f15e3](https://github.com/eCy-coding/ollamas/commit/b8f15e317eca8f95aa9bfd205bb7791de8f355ca))
* **agent:** wire measured combination into live ReAct agent (/api/agent/chat) ([37e0775](https://github.com/eCy-coding/ollamas/commit/37e0775af3f584926e9dc0add17ab76d096ba278))
* **combo:** correctness-max model combination — measured, encoded, wired ([cef26bd](https://github.com/eCy-coding/ollamas/commit/cef26bd8708bc6b2673da15689639a934e64713a))
* **content:** autonomous headless content+cover pipeline (no Claude Code) ([b5b4616](https://github.com/eCy-coding/ollamas/commit/b5b46161a6af9e43cf936be094fde49c502e6b28))
* **firecrawl:** key-in-.env REST wrapper (scrape/crawl/search -&gt; markdown, no MCP) ([5bc91ae](https://github.com/eCy-coding/ollamas/commit/5bc91aeeb10eb7a62dd3e02a5287ff77a2ce1681))
* **fleet:** 3-tier agent hierarchy — ClaudeCode &gt; ollamas-claude &gt; sub-agents ([6886f2a](https://github.com/eCy-coding/ollamas/commit/6886f2a6e0ba2650d8b7bf88ac112b1fb9205025))
* **monitor:** --heartbeat self-improving loop (JSONL learning store + drift detection) ([f785a49](https://github.com/eCy-coding/ollamas/commit/f785a490a7bd8af4cd733c3dde4fa4e17760c61b))
* **monitor:** deterministic system-invariant monitor + agent benchmark/routing ([f128e7b](https://github.com/eCy-coding/ollamas/commit/f128e7b1269cd947da043cf4c2f8d315d27e6700))
* **observability:** Prometheus scrape + alerts + Grafana dashboard for the gateway ([35dfe9d](https://github.com/eCy-coding/ollamas/commit/35dfe9defddd04359f1f0a85a5d4a9a4d1c3bafc))
* **onboarding:** instant-on layer — ready gate, slash commands, quickstart ([4c9e7d0](https://github.com/eCy-coding/ollamas/commit/4c9e7d042e6ff3e8b5fd1ee5aa51f8a585b95e9e))
* **ops:** single coordinated Tier-1 conductor — fastest/safest/correct e2e ([d8e1b37](https://github.com/eCy-coding/ollamas/commit/d8e1b372a1cc488129f06f52ff25c4966085959a))
* **providers:** API key pool + auto-rotation on quota/auth (user keys only) ([b555399](https://github.com/eCy-coding/ollamas/commit/b55539928666acc2e75cdd2d25a6b992d5f1d4c7))
* **substack:** reliable scrape-free Substack digest from Gmail + trend ledger ([d1dd030](https://github.com/eCy-coding/ollamas/commit/d1dd030847926d42f74bee5462489a47b9fb9d01))
* **substack:** Substack mastery toolkit (public via firecrawl, auth via Chrome MCP) ([97eef45](https://github.com/eCy-coding/ollamas/commit/97eef450a86bbea5f3fd558bc92dcfc14bb18467))
* **workspace:** binary upload/download — HTTP routes + agent tools + MCP + UI ([9e6e902](https://github.com/eCy-coding/ollamas/commit/9e6e902d2e67cd914a26cce5f096655ac778ccf2))


### Bug Fixes

* **agent:** calibrate sub-agent grep_search guard (no shell metachars, no blind retry) ([3202f84](https://github.com/eCy-coding/ollamas/commit/3202f84123bec657034305a0664d280332797389))
* **agent:** cross-provider tool-call robustness — repair + validator-feedback (CRITICAL-3) ([8c57f1d](https://github.com/eCy-coding/ollamas/commit/8c57f1d638cb4b4b06b3d0090b1c8c72ef9b26b4))
* **bridge+agent:** host-bridge localhost fallback + agent model-leak guard (Faz9 live finds) ([918f452](https://github.com/eCy-coding/ollamas/commit/918f452cae129a5c6a0feace0cc67ad1ad071cc7))
* **frontend:** close the apiClient choke-point in SaaSAdmin + restore ESLint enforcement ([01490d6](https://github.com/eCy-coding/ollamas/commit/01490d610e843a0910e9332071cbff125f358976))
* **orchestration:** autopilot activation paths + persist combination policy ([f9ed527](https://github.com/eCy-coding/ollamas/commit/f9ed5275a51209a194dc948ce6e884ecaef7b951))
* **orchestration:** autopilot no longer mislabels conduct's RED gate-exit as a crash ([cc4576a](https://github.com/eCy-coding/ollamas/commit/cc4576a6487be44956bd6e5706b37714b24ef22e))
* **providers:** a requested model name belonged to its provider but was carried ([bea1a02](https://github.com/eCy-coding/ollamas/commit/bea1a0221faad9c28cffa7ba7f92e9d0e4d088cc))
* **providers:** demo-fallback honesty — no fabricated output to live agent (CRITICAL-2) ([8bf2046](https://github.com/eCy-coding/ollamas/commit/8bf2046e70369d968ed3d0008a2b0762f77e4faa))
* **providers:** ollama-cloud valid default model + strip -cloud suffix ([2ee7f35](https://github.com/eCy-coding/ollamas/commit/2ee7f359f8f7987d63dc256b6c05352d5f804994))
* scripts/test-signal.mjs wraps 'vitest run', passes through args/stdio + exit code, and writes a fresh {status,failedTests} after every run. package.json test → the wrapper. Verified: stale 'failed' marker → npm test → '{status:"passed"}' + 838/0; quality.ts backend lane GREEN, redLanes=[]. ([976ba02](https://github.com/eCy-coding/ollamas/commit/976ba024013596ca6debd5503d378ca30e700980))
* **test:** npm test now refreshes test-results/.last-run.json (reconnect quality signal) ([976ba02](https://github.com/eCy-coding/ollamas/commit/976ba024013596ca6debd5503d378ca30e700980))
