# Changelog

## [1.23.0](https://github.com/eCy-coding/ollamas/compare/v1.22.1...v1.23.0) (2026-06-24)


### Features

* **agent:** calibrated ollamas sub-agent dispatcher + fix fallback model leak ([bea1a02](https://github.com/eCy-coding/ollamas/commit/bea1a0221faad9c28cffa7ba7f92e9d0e4d088cc))
* **agent:** role-aware model routing in agent-dispatch — consume measured MODEL_SELECTION ([b8f15e3](https://github.com/eCy-coding/ollamas/commit/b8f15e317eca8f95aa9bfd205bb7791de8f355ca))
* **combo:** correctness-max model combination — measured, encoded, wired ([cef26bd](https://github.com/eCy-coding/ollamas/commit/cef26bd8708bc6b2673da15689639a934e64713a))
* **content:** autonomous headless content+cover pipeline (no Claude Code) ([b5b4616](https://github.com/eCy-coding/ollamas/commit/b5b46161a6af9e43cf936be094fde49c502e6b28))
* **firecrawl:** key-in-.env REST wrapper (scrape/crawl/search -&gt; markdown, no MCP) ([5bc91ae](https://github.com/eCy-coding/ollamas/commit/5bc91aeeb10eb7a62dd3e02a5287ff77a2ce1681))
* **fleet:** 3-tier agent hierarchy — ClaudeCode &gt; ollamas-claude &gt; sub-agents ([6886f2a](https://github.com/eCy-coding/ollamas/commit/6886f2a6e0ba2650d8b7bf88ac112b1fb9205025))
* **monitor:** --heartbeat self-improving loop (JSONL learning store + drift detection) ([f785a49](https://github.com/eCy-coding/ollamas/commit/f785a490a7bd8af4cd733c3dde4fa4e17760c61b))
* **monitor:** deterministic system-invariant monitor + agent benchmark/routing ([f128e7b](https://github.com/eCy-coding/ollamas/commit/f128e7b1269cd947da043cf4c2f8d315d27e6700))
* **onboarding:** instant-on layer — ready gate, slash commands, quickstart ([4c9e7d0](https://github.com/eCy-coding/ollamas/commit/4c9e7d042e6ff3e8b5fd1ee5aa51f8a585b95e9e))
* **ops:** single coordinated Tier-1 conductor — fastest/safest/correct e2e ([d8e1b37](https://github.com/eCy-coding/ollamas/commit/d8e1b372a1cc488129f06f52ff25c4966085959a))
* **providers:** API key pool + auto-rotation on quota/auth (user keys only) ([b555399](https://github.com/eCy-coding/ollamas/commit/b55539928666acc2e75cdd2d25a6b992d5f1d4c7))
* **substack:** reliable scrape-free Substack digest from Gmail + trend ledger ([d1dd030](https://github.com/eCy-coding/ollamas/commit/d1dd030847926d42f74bee5462489a47b9fb9d01))
* **substack:** Substack mastery toolkit (public via firecrawl, auth via Chrome MCP) ([97eef45](https://github.com/eCy-coding/ollamas/commit/97eef450a86bbea5f3fd558bc92dcfc14bb18467))
* **workspace:** binary upload/download — HTTP routes + agent tools + MCP + UI ([9e6e902](https://github.com/eCy-coding/ollamas/commit/9e6e902d2e67cd914a26cce5f096655ac778ccf2))


### Bug Fixes

* **agent:** calibrate sub-agent grep_search guard (no shell metachars, no blind retry) ([3202f84](https://github.com/eCy-coding/ollamas/commit/3202f84123bec657034305a0664d280332797389))
* **orchestration:** autopilot activation paths + persist combination policy ([f9ed527](https://github.com/eCy-coding/ollamas/commit/f9ed5275a51209a194dc948ce6e884ecaef7b951))
* **providers:** a requested model name belonged to its provider but was carried ([bea1a02](https://github.com/eCy-coding/ollamas/commit/bea1a0221faad9c28cffa7ba7f92e9d0e4d088cc))
* **providers:** ollama-cloud valid default model + strip -cloud suffix ([2ee7f35](https://github.com/eCy-coding/ollamas/commit/2ee7f359f8f7987d63dc256b6c05352d5f804994))
