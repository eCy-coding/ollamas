# COMPLETION_GAPS.md — project-completion gap report (auto-generated)

> Auto: `tsx orchestration/bin/completion-scan.ts` · 2026-07-03T00:03:01Z. The council's end-to-end scan of ollamas:
> what code / folders / languages are still needed to complete the project, with justifications and a
> task distribution across the fleet streams. Evidence only — every gap derives from a real scan fact.

## Verdict: 25 gap(s) — 1 P1 · 0 P2 · 24 P3

## §A — Language breakdown (tracked files)
| Language | Files |
|----------|-------|
| .ts | 531 |
| .md | 184 |
| .json | 135 |
| .mjs | 98 |
| .tsx | 59 |
| .sh | 23 |
| .yml | 14 |
| .swift | 9 |
| .yaml | 8 |
| .plist | 7 |
| .gitignore | 6 |
| .py | 6 |

> TypeScript is the primary language. Tests are centralized under `tests/` (144 files) —
> a lane having no `*.test.ts` beside its source is NOT a coverage gap (avoids false positives).

## §B — Missing code
- **[P3] Backend route `/api/ready` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/openapi.json` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/revenue/check` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/github/webhook` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/notify/config` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/notify/test` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/generate` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/agent/sessions/*/events` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/macos-terminal` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/cluster/status` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/saas/upstreams/*` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/saas/upstreams/status` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/saas/self/keys` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/saas/self/keys/*/revoke` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`
- **[P3] Backend route `/api/saas/usage` is never called by the frontend** — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.  
  ↳ evidence: server route with no matching src /api call · owner: `errors-resilience`

## §C — Missing / sparse folders (SUSPECTED, verify intent)
- `assets` — 1 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `client` — 1 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `packaging` — 1 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `tokens-light` — 1 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `ops` — 2 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `public` — 2 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `tokens` — 2 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `web` — 4 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.
- `backend` — 5 tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.

## §D — Missing / under-migrated languages
- **98 .mjs files still to migrate → TypeScript** (owner: `mjs-migration`; in-place `@ts-check` progress: **72/98**).
  - scripts: 31
  - bin/host-bridge/tools: 19
  - bin/host-bridge: 12
  - .claude/hooks: 10
  - bin/host-bridge/lib: 9
  - tests/fixtures: 7
  - Justification: TS-primary directive; .mjs bypasses `tsc` type-checking + shared type contracts.

## §E — Task distribution (per fleet stream, ≤2 tasks/model)
### `mjs-migration` (1)
- [P1] 98 .mjs files still to migrate to TypeScript (72 already `@ts-check`'d) — TS is the primary language (type-safety, single toolchain); un-migrated .mjs escapes tsc + the shared type contracts.
### `errors-resilience` (15)
- [P3] Backend route `/api/ready` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/openapi.json` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/revenue/check` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/github/webhook` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/notify/config` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/notify/test` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/generate` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/agent/sessions/*/events` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/macos-terminal` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/cluster/status` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/saas/upstreams/*` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/saas/upstreams/status` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/saas/self/keys` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/saas/self/keys/*/revoke` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- [P3] Backend route `/api/saas/usage` is never called by the frontend — Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
### `typescript-core` (9)
- [P3] Folder `assets` has only 1 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `client` has only 1 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `packaging` has only 1 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `tokens-light` has only 1 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `ops` has only 2 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `public` has only 2 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `tokens` has only 2 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `web` has only 4 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- [P3] Folder `backend` has only 5 tracked file(s) — possibly a stub lane — A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).

> Streams reference: fleet-plan.ts STREAMS. Fleet already reached 6/6 gated proposals (FLEET_RUN.md);
> this report is the deterministic census layer of the council's collective scan (+ CODINGS_STATUS.md).
