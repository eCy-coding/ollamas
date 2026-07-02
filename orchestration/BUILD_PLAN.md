# BUILD_PLAN.md — how to build the missing code, step by step (auto-generated)

> Auto: `tsx orchestration/bin/build-plan.ts` · 2026-07-02T13:58:40Z. Turns COMPLETION_GAPS into an ordered build plan:
> phases run in fleet-stream dependency order (foundation first), gaps within a phase by severity, each
> with a fast / safe / correct recipe. Fastest = reuse adjacent patterns + batch; Safest = verify-before-touch,
> behavior-preserving, test-first; Correct = typed + gated each step. This is a PLAN — it builds nothing.

## Overview: 3 phase(s) · 32 step(s) · 4 P1
- T1 — `mjs-migration` (1 step, 1 P1)
- T2 — `typescript-core` (16 steps, 3 P1)
- T3 — `errors-resilience` (15 steps)

## T1 — Section: `mjs-migration`

### T1.1 · [P1] 98 .mjs files still to migrate to TypeScript
- **Why:** TS is the primary language (type-safety, single toolchain); un-migrated .mjs escapes tsc + the shared type contracts.
- **Evidence:** git ls-files '*.mjs' = 98; concentrated in scripts (31), bin/host-bridge/tools (19), bin/host-bridge (12)
- **Approach (fast/safe/correct):** Incremental, behavior-preserving .mjs → .ts migration — never a big-bang rewrite.
  1. Batch by directory, smallest/leaf first (scripts → bin/host-bridge/lib → tools).
  2. Per file: rename .mjs → .ts, add explicit param/return types, keep the runtime IDENTICAL (no logic change).
  3. Update the importers' extension + any build/register manifest.
  4. Gate each file: `tsc --noEmit` clean + the file's existing test still green before moving on.
- **Verify:** tsc --noEmit 0 + full test suite green after each directory batch; zero behavior diff.

## T2 — Section: `typescript-core`

### T2.1 · [P1] Frontend calls `/api/ecysearcher` but no backend route serves it
- **Why:** A called-but-unimplemented endpoint is a runtime 404 — a genuine missing implementation.
- **Evidence:** src /api call with no matching server route
- **Approach (fast/safe/correct):** Verify the call is REAL before implementing — some are URL-concat regex artifacts.
  1. Open the frontend source line: is it a genuine endpoint or a base-URL concatenation artifact?
  2. If real: implement the Express handler in server/** reusing an adjacent handler pattern, with input validation + typed body + error handling.
  3. If artifact: fix the frontend call (correct the constructed URL); no backend change.
  4. Add a test (request → expected status/shape) and register the route at the choke-point.
- **Verify:** New route returns the expected status for valid + invalid input; test green; no 404 for the real call.

### T2.2 · [P1] Frontend calls `/api/ecysearcher/api/search/search/analytics` but no backend route serves it
- **Why:** A called-but-unimplemented endpoint is a runtime 404 — a genuine missing implementation.
- **Evidence:** src /api call with no matching server route
- **Approach (fast/safe/correct):** Verify the call is REAL before implementing — some are URL-concat regex artifacts.
  1. Open the frontend source line: is it a genuine endpoint or a base-URL concatenation artifact?
  2. If real: implement the Express handler in server/** reusing an adjacent handler pattern, with input validation + typed body + error handling.
  3. If artifact: fix the frontend call (correct the constructed URL); no backend change.
  4. Add a test (request → expected status/shape) and register the route at the choke-point.
- **Verify:** New route returns the expected status for valid + invalid input; test green; no 404 for the real call.

### T2.3 · [P1] Frontend calls `/api/ecysearcher/api/search/search` but no backend route serves it
- **Why:** A called-but-unimplemented endpoint is a runtime 404 — a genuine missing implementation.
- **Evidence:** src /api call with no matching server route
- **Approach (fast/safe/correct):** Verify the call is REAL before implementing — some are URL-concat regex artifacts.
  1. Open the frontend source line: is it a genuine endpoint or a base-URL concatenation artifact?
  2. If real: implement the Express handler in server/** reusing an adjacent handler pattern, with input validation + typed body + error handling.
  3. If artifact: fix the frontend call (correct the constructed URL); no backend change.
  4. Add a test (request → expected status/shape) and register the route at the choke-point.
- **Verify:** New route returns the expected status for valid + invalid input; test green; no 404 for the real call.

### T2.4 · [P2] Unfinished marker in `orchestration/bin/completion-scan.ts`
- **Why:** An explicit TODO/stub marks incomplete logic the author flagged.
- **Evidence:** TODO/FIXME/not-implemented found in file
- **Approach (fast/safe/correct):** Read the marker context first — some are grep-arg false positives (the literal word TODO in code).
  1. Open the file at the marker: is it real unfinished logic or an incidental occurrence of TODO/FIXME?
  2. If real: implement the flagged logic, smallest correct change, with a test.
  3. If false positive: no action (the scanner honestly flags it as 'found in file').
- **Verify:** Marker resolved (implemented + tested) or confirmed a false positive; no dangling unfinished logic.

### T2.5 · [P2] Unfinished marker in `orchestration/bin/dod.ts`
- **Why:** An explicit TODO/stub marks incomplete logic the author flagged.
- **Evidence:** TODO/FIXME/not-implemented found in file
- **Approach (fast/safe/correct):** Read the marker context first — some are grep-arg false positives (the literal word TODO in code).
  1. Open the file at the marker: is it real unfinished logic or an incidental occurrence of TODO/FIXME?
  2. If real: implement the flagged logic, smallest correct change, with a test.
  3. If false positive: no action (the scanner honestly flags it as 'found in file').
- **Verify:** Marker resolved (implemented + tested) or confirmed a false positive; no dangling unfinished logic.

### T2.6 · [P2] Unfinished marker in `orchestration/bin/lib/dod.ts`
- **Why:** An explicit TODO/stub marks incomplete logic the author flagged.
- **Evidence:** TODO/FIXME/not-implemented found in file
- **Approach (fast/safe/correct):** Read the marker context first — some are grep-arg false positives (the literal word TODO in code).
  1. Open the file at the marker: is it real unfinished logic or an incidental occurrence of TODO/FIXME?
  2. If real: implement the flagged logic, smallest correct change, with a test.
  3. If false positive: no action (the scanner honestly flags it as 'found in file').
- **Verify:** Marker resolved (implemented + tested) or confirmed a false positive; no dangling unfinished logic.

### T2.7 · [P2] Unfinished marker in `orchestration/bin/lib/completion.ts`
- **Why:** An explicit TODO/stub marks incomplete logic the author flagged.
- **Evidence:** TODO/FIXME/not-implemented found in file
- **Approach (fast/safe/correct):** Read the marker context first — some are grep-arg false positives (the literal word TODO in code).
  1. Open the file at the marker: is it real unfinished logic or an incidental occurrence of TODO/FIXME?
  2. If real: implement the flagged logic, smallest correct change, with a test.
  3. If false positive: no action (the scanner honestly flags it as 'found in file').
- **Verify:** Marker resolved (implemented + tested) or confirmed a false positive; no dangling unfinished logic.

### T2.8 · [P3] Folder `assets` has only 1 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files assets = 1
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.9 · [P3] Folder `client` has only 1 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files client = 1
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.10 · [P3] Folder `packaging` has only 1 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files packaging = 1
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.11 · [P3] Folder `tokens-light` has only 1 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files tokens-light = 1
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.12 · [P3] Folder `ops` has only 2 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files ops = 2
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.13 · [P3] Folder `public` has only 2 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files public = 2
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.14 · [P3] Folder `tokens` has only 2 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files tokens = 2
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.15 · [P3] Folder `web` has only 4 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files web = 4
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

### T2.16 · [P3] Folder `backend` has only 5 tracked file(s) — possibly a stub lane
- **Why:** A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).
- **Evidence:** git ls-files backend = 5
- **Approach (fast/safe/correct):** Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.
  1. Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?
  2. If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.
  3. If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).
- **Verify:** Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.

## T3 — Section: `errors-resilience`

### T3.1 · [P3] Backend route `/api/ready` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.2 · [P3] Backend route `/api/openapi.json` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.3 · [P3] Backend route `/api/revenue/check` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.4 · [P3] Backend route `/api/github/webhook` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.5 · [P3] Backend route `/api/notify/config` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.6 · [P3] Backend route `/api/notify/test` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.7 · [P3] Backend route `/api/generate` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.8 · [P3] Backend route `/api/agent/sessions/*/events` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.9 · [P3] Backend route `/api/macos-terminal` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.10 · [P3] Backend route `/api/cluster/status` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.11 · [P3] Backend route `/api/saas/upstreams/*` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.12 · [P3] Backend route `/api/saas/upstreams/status` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.13 · [P3] Backend route `/api/saas/self/keys` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.14 · [P3] Backend route `/api/saas/self/keys/*/revoke` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

### T3.15 · [P3] Backend route `/api/saas/usage` is never called by the frontend
- **Why:** Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.
- **Evidence:** server route with no matching src /api call
- **Approach (fast/safe/correct):** Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.
  1. Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.
  2. If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).
  3. If genuinely dead (no consumer anywhere): remove the route + its handler + tests.
- **Verify:** Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.

## Sequence rationale
- Phases follow the fleet dependency DAG (DEFAULT_DEPS): shell-harden → mjs-migration → typescript-core →
  {errors-resilience, concurrency-safety} → test-coverage. Migration establishes the TS base before new
  logic; resilience layers on the core; tests verify last. Within a phase, P1 before P2 before P3.
- Each step is gated (tsc + tests) before the next — no half-work, no big-bang.
