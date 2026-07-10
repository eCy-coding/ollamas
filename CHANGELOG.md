# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Work on branch `feat/v-final-train` since v1.23.0. It has two layers: the
integrated lane work (tunnel, contract/federation, providers, orchestration,
security) and the v-final release train (V1–V8 below, staged as
v1.24.0–v1.31.0; not yet tagged individually — a single GA tag, v1.33.0,
lands at general availability).

### Added (integrated lane work since v1.23.0)

- Cloudflare tunnel transport (quick + named tunnels), streaming reverse-proxy
  gateway with auth, rate limiting and access logs, and one-command zero-touch
  setup with launchd daemons (vT12–vT15).
- Contract/federation layer: multi-machine pool ledger, heartbeats, RPC shard
  orchestration, scheduler federation, one-click device onboarding with a
  signed CLI bundle (vK1–vK19).
- Free-provider harness: catalog of free-tier cloud providers (Groq, Mistral,
  Cerebras, Scaleway, Pollinations, Cloudflare Workers AI, ...),
  `provider::model` routing, API key pool with auto-rotation, key-doctor
  (validate/connect/keychain scan), guided `keys onboard`, quota-aware
  scheduling and persistent cooldowns.
- Hardware vault: Secure-Enclave-backed master key with keychain write-back,
  always-running key-health loop and `/api/keys/health` convergence signal.
- $0 local conductor: autonomous orchestra loop with council quorum voting,
  task catalog, fleet worker dispatch (Terminal.app/iTerm2 tabs), gated
  SEARCH/REPLACE apply path and Constitutional-Alignment harness (vO31–vO65).
- Telemetry cockpit: per-request telemetry core with SSE feed, model-ops
  panels, GitHub Actions panel, first-party GitHub search, threat-intel feed,
  Google Calendar/Gmail read-only tabs, Siri search assistant, key-health
  panel.
- OpenAPI documentation for ~26 public routes; Brewfile + deps-doctor;
  Fable-5 orchestra-conductor skill with slash commands.

### Fixed (integrated lane work since v1.23.0)

- Security: SSRF guard and command allowlist for tenant-supplied MCP
  upstreams (RCE fix), zero-leak redaction of agent tool-call args,
  shell-string `execSync` migrated to argv `execFileSync`, blocking security
  CI gate (gitleaks + semgrep + trivy), explicit GCM authTagLength.
- Reliability: atomic config/master-key writes, fail-closed master key on
  restart, streaming abort fail-safe, atomic-write race fix, orchestra
  conductor thrash root-fixes, deterministic (de-flaked) provider tests.

### Changed (integrated lane work since v1.23.0)

- `@ts-check` migration across host-bridge, scripts and hooks (98-file
  manifest, batches 1–8); IO-free pure cores extracted for catalog tools;
  DoD/coverage gates (v8 coverage `lines:70`, perf-smoke p95 CI budget).

### v-final release train (V1–V8, staged as v1.24.0–v1.31.0, tagged at GA)

#### V1 — honest identity (staged v1.24.0)

- Added: real README, `setup.sh` wrapper, `CONTRIBUTING.md` + Code of
  Conduct; package version bumped to 1.24.0 [M-026, M-027, M-021, M-028].
- Changed: canonical pointer to the 16-VERSIYON roadmap [M-025].

#### V2 — bring-your-own-model (staged v1.25.0)

- Added: usable BYO-model flow — custom-OpenAI endpoint with catalog dropdown
  and server model list [M-031], first-run onboarding [M-037], model guide
  [M-033].

#### V3 — developer docs (staged v1.26.0)

- Added: developer-extensibility docs — adding-a-tool, extension guide,
  HOWTO-ADD-SKILL, CLI guide, API quickstart, troubleshooting
  [M-029, M-030, M-034, M-035, M-040, M-032].

#### V4 — security tests (staged v1.27.0)

- Added: security regression coverage for localOwnerGuard, commander, store,
  providers and threatfeed ReDoS; Colab urllib guard; docker-compose
  `read_only` [M-001..M-011].

#### V5 — test integrity (staged v1.28.0)

- Added: boot harness making pipeline + adminGuard testable [M-050, M-004,
  M-006]; migration uniqueness + rollback tests [M-012, M-045].
- Fixed: M-037 ai.test regression; fresh suite 1518 passing [M-014].

#### V6 — billing, i18n, GDPR, performance (staged v1.29.0)

- Added: billing e2e chain [M-017], i18n parity with RTL/Intl [M-019, M-048],
  GDPR erasure/export [M-047]; Lighthouse run at performance 0.96 [M-018].

#### V7 — per-model overrides + GGUF guide (staged v1.30.0)

- Added: per-model `num_ctx` / `temperature` / `keep_alive` / system-prompt
  overrides (UI + API) [M-038]; GGUF/Modelfile import guide [M-039].
- Fixed: `/api/model-overrides` gated behind localOwnerGuard [M-038].

#### V8 — deployment robustness (staged v1.31.0)

- Added: cloud master-key fail-closed [M-020], unified deploy guide
  [M-036, M-046], install/rollback drills and doc fixes
  [M-023, M-024, M-022].

## [1.23.0] - 2026-06-25

### Added

- Measured model combination wired into the live ReAct agent
  (`/api/agent/chat`) with correctness-max policy.
- Binary upload/download across HTTP routes, agent tools, MCP and UI.
- Instant-on onboarding layer: ready gate, slash commands, quickstart.
- API key pool with auto-rotation on quota/auth errors (user keys only).
- Deterministic system-invariant monitor with self-improving `--heartbeat`
  loop and launchd job; 3-tier fleet agent hierarchy and calibrated
  sub-agent dispatcher.
- Autonomous headless content pipeline, Substack toolkit and Firecrawl REST
  wrapper.

### Fixed

- Multi-step tool ReAct on strict cloud providers (Anthropic/OpenAI) and
  cross-provider tool-call robustness (repair + validator feedback).
- Demo-fallback honesty: no fabricated output ever reaches the live agent.
- Bridge realpath write-confinement (symlinks cannot escape
  `BRIDGE_WRITE_ROOTS`); heartbeat reads the real claim ledger; empty
  suppress `kindPattern` rejected (was suppressing all findings).
- `grep_search` via no-shell argv; MCP `resources/list` tree flattening;
  localhost Ollama fallback in `listModels`; orchestration lock acquisition
  and champion-gate ranking.

### Changed

- Project-wide non-working-function audit ledger and harness scripts
  (Faz 11–13).

## [1.22.1] - 2026-06-21

### Fixed

- Security: terminal exec hardened to `execFile` and confined filesystem
  paths annotated (Semgrep P0).

## [1.22.0] - 2026-06-21

### Fixed

- Agent tool-path unbroken across all providers (real coding, no demo).
- `.env` loaded via dotenv at boot so provider keys resolve in local dev.
- Per-instance Vite HMR websocket port (PORT+20000) — no more 24678
  collisions across dev/test servers.

### Changed

- Dependency override `tmp@^0.2.7`, fixing a high-severity symlink /
  path-traversal advisory in the dev-only `@lhci/cli` chain.

## [1.21.0] - 2026-06-21

First tagged release: the all-lanes integration merge (tunnel, orchestration,
Colab, deploy hardening, scripts, frontend, CLI, ingest).

### Added

- Choke-point tools: `bench_model` (llama-bench tok/s), `mac_power`
  (powermetrics telemetry), `eval_prompt` (promptfoo verify),
  `count_tokens` (js-tiktoken).
- MCP consume fan-out to multiple upstream clusters and MCP v1.20 resource
  subscriptions (`resources/subscribe` + update notifications).
- Colab local-runtime (Docker-first, auto-port) with a zero-manual headless
  dev-loop and hybrid bug triage (local first-pass + egress-gated Gemini).
- Canonical `artifacts/` binary-folder build architecture.

### Fixed

- Security: SaaS fail-closed gate for the dashboard surface, credential-vault
  `/api/keys` + `/api/models` gating in SaaS mode, command-injection via
  `execFile`, tool-call `JSON.parse` guard, CI ref-name injection.
- Billing: crypto-random Stripe meter idempotency key (was `Math.random`).
- Workspace file API input validation; agent `messages[]` validation;
  host-bridge `import.meta.url` guard so the bundled `dist/server.cjs` boots.

[Unreleased]: https://github.com/eCy-coding/ollamas/compare/v1.23.0...HEAD
[1.23.0]: https://github.com/eCy-coding/ollamas/compare/v1.22.1...v1.23.0
[1.22.1]: https://github.com/eCy-coding/ollamas/compare/v1.22.0...v1.22.1
[1.22.0]: https://github.com/eCy-coding/ollamas/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/eCy-coding/ollamas/releases/tag/v1.21.0

<!--
Release notes template (copy for each new release):

## [X.Y.Z] - YYYY-MM-DD

### Added
- New features.

### Fixed
- Bug fixes.

### Changed
- Changes in existing functionality (refactor/chore/docs).
-->
