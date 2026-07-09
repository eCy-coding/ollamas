# stub-folder 3-probe triage (v1.27.1)

> Date: 2026-07-09 · Branch: `feat/key-autonomy` · Mode: **ANALYSIS ONLY** (no delete, no README — 1.27.2 = [T0]).
> Method: per candidate dir, 3 probes — **probe-1** `git log -1 --format=%cr` (last-commit age), **probe-2** inbound quoted-import / entry-point grep across `src server cli orchestration scripts tests bin` + root entry files, **probe-3** build/serve/CLI reachability (Makefile compile target, root `server.ts` import chain, entry-point manifest). Ruling: **KEEP** (live use) · **DEAD** (0-ref + unreachable → [T0] delete candidate) · **STUB** (intentional placeholder → [T0] README candidate).
> Candidates: 12 (all sparse dirs ≤ 2 tracked files, found via `git ls-files` per-dir file-count).

## Triage table

| # | dir | probe-1 last-commit | probe-2 inbound-ref | probe-3 reachable? | RULING | citation |
|---|-----|--------------------|--------------------|--------------------|--------|----------|
| 1 | `backend/contracts` (MultiLevelReward.sol, 176L) | 4 weeks ago | symbol `MultiLevelReward` = **0**; path only in orchestration audit docs + `personas.ts` `orphan-dir` | **NO** — no solc/hardhat/foundry build target anywhere (only backend/ dir with no Makefile compile) | **STUB** | `scripts/gen-manifest.mjs` (not listed), Makefile (no `.sol` target), `orchestration/bin/lib/personas.ts:52`, `orchestration/plans/notes/project-architect.md:6` |
| 2 | `backend/daemon` (idle_daemon.c, 106L) | 4 weeks ago | 0 TS import; **manifest entry** `idle-daemon` | **YES** — `make build-idle` → `gcc/clang -O2 -o artifacts/bin/idle-daemon`; `artifacts/bin/idle-daemon` **present** | **KEEP** | `Makefile:67-77`, `scripts/gen-manifest.mjs:21` |
| 3 | `backend/mesh` (p2p_network.go, 190L) | 4 weeks ago | 0 TS import; manifest entry `p2p-network`; string-only in `orchestration/tests/*.test.ts` | **YES** — `make build-p2p` → `go build -o artifacts/bin/p2p-network` (bin absent = go toolchain missing, target live) | **KEEP** | `Makefile:37-42`, `scripts/gen-manifest.mjs:18` |
| 4 | `backend/orchestrator` (hardware_orchestrator.rs, 148L) | 4 weeks ago | 0 TS import; manifest entry; runtime bin ref in `server/orchestrator.ts:13` (`./bin/hardware_orchestrator`) | **YES** — `make build-orchestrator` → `rustc`; `artifacts/bin/hardware-orchestrator` **present** | **KEEP** | `Makefile:50-52`, `scripts/gen-manifest.mjs:19`, `server/orchestrator.ts:13` |
| 5 | `backend/sandbox` (secure_sandbox.rs, 135L) | 4 weeks ago | 0 TS import; manifest entry `secure-sandbox` | **YES** — `make build-sandbox` → `rustc`; `artifacts/bin/secure-sandbox` **present** | **KEEP** | `Makefile:57-62`, `scripts/gen-manifest.mjs:20` |
| 6 | `server/billing` (stripe.ts, 242L) | 9 days ago | **imported by root `server.ts:64`** (11 symbols) + 3 test files | **YES** — wired into gateway routes (`server.ts:433/537/2384/2704/2709/2752`) | **KEEP** | `server.ts:64`, `tests/server-stripe-*.test.ts` |
| 7 | `server/tools` (search_browser.ts, 29L) | 4 weeks ago | real import = **0**; only string in `tools.json:70` (`browser_search` entryPoint) | **NO** — not in tool-registry; repo's own audit flags it dead | **DEAD** | `.claude/CLEANUP-CANDIDATES.md:19` (row #5 "dead code, import=0, tool-registry'de yok"), `tools.json:70` |
| 8 | `server/webhooks` (outbound.ts, 91L) | 11 days ago | **imported by root `server.ts:58`** (startWebhookWorker/stop/verify) + 3 test files | **YES** — webhook worker started at boot | **KEEP** | `server.ts:58`, `tests/webhooks.test.ts`, `tests/ukp-ingest*.test.ts` |
| 9 | `client` (ai-client.ts, 77L) | 3 weeks ago | real import = **0**; only string in `orchestration/COUNCIL.json` (data). Not in package.json `exports`/`files`/`bin` → not shipped as SDK | **NO** — no internal import, no publish target | **DEAD** | `.claude/CLEANUP-CANDIDATES.md:20` (row #6 "orphan, import=0"), `package.json` (no client export) |
| 10 | `assets/.aistudio` (only `.gitignore` = `*`, 0 content) | 4 weeks ago | 0 | n/a — deliberately empty (ignore-all) placeholder for AI Studio scratch assets | **STUB** | `assets/.aistudio/.gitignore` (`*`) |
| 11 | `docs/site` (index.html, 92L) | 2 weeks ago | read at runtime by `server/revenue.ts:157` as storefront template | **YES** — `genStorefront` fills placeholders → `audit-out/storefront.html` | **KEEP** | `server/revenue.ts:157` |
| 12 | `orchestration/assets` (cockpit.html, 214L) | 6 days ago | served by `orchestration/bin/serve.ts:24` (`HTML_PATH = ../assets/cockpit.html`) | **YES** — live cockpit UI at `GET /` | **KEEP** | `orchestration/bin/serve.ts:24` |

## Ruling summary

- **KEEP = 8**: `backend/daemon`, `backend/mesh`, `backend/orchestrator`, `backend/sandbox` (native Makefile build pipeline → `artifacts/bin/`, indexed by manifest), `server/billing`, `server/webhooks` (root `server.ts` imports), `docs/site` (storefront template), `orchestration/assets` (cockpit UI).
- **DEAD = 2** → [T0] delete candidates (runtime-verify first, server lane): `server/tools/search_browser.ts`, `client/ai-client.ts`. Both already listed in `.claude/CLEANUP-CANDIDATES.md` rows #5/#6.
- **STUB = 2** → [T0] README/roadmap-owner candidates: `backend/contracts` (real 176L Solidity, no build/deploy wiring — bind to roadmap or delete), `assets/.aistudio` (intentional empty ignore-all dir).

## Key finding — stale prior audit (false-positive orphans)

`orchestration/plans/notes/project-architect.md:6-17` flags **all five** `backend/{contracts,daemon,mesh,orchestrator,sandbox}` as orphan ("hiçbir import yok"). That scan (`personas.ts` `orphan-dir`, comment L51) **only counts quoted TS imports** and therefore misses the **Makefile native-build chain** (`build-all` → `rustc`/`go build`/`gcc` → `artifacts/bin/` → `manifest.json`). Four of the five are in fact **live-built** (3 have compiled artifacts present) → **KEEP**, not orphan. Only `backend/contracts` (`.sol`, no compiler target) is genuinely unwired → STUB. [T0] should treat the prior "5 orphan dirs" finding as superseded by this triage.

## [T0]-pending action list

| dir | ruling | [T0] action (1.27.2, gated) |
|-----|--------|------------------------------|
| `server/tools/search_browser.ts` | DEAD | runtime-verify no dynamic load → delete (server lane) + drop `browser_search` from `tools.json` |
| `client/ai-client.ts` | DEAD | confirm not an intended shipped SDK → delete, or add to `package.json` exports if keeping |
| `backend/contracts` | STUB | add README (future on-chain MultiLevelReward) + roadmap owner, OR delete if no chain plan |
| `assets/.aistudio` | STUB | add README noting it is an intentional empty scratch dir, or leave as-is |
