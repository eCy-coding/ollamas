---
description: Scan ollamas end-to-end and report what's still needed to complete the project — missing code, missing/sparse folders, missing/under-migrated languages — each with a justification and a task distribution across the fleet streams → orchestration/COMPLETION_GAPS.md. Evidence only (git ls-files census + route drift via graph.gapAnalysis); avoids false positives (centralized tests, sparse folders flagged SUSPECTED not confirmed-missing).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/completion-scan.ts:*), Bash(npx tsx orchestration/bin/completion-scan.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/completion-scan.ts`. It builds a real census from `git ls-files` (language breakdown, `.mjs` migration targets by directory, `.sh` count, centralized test count, sparse top-level folders, stub/TODO markers) and computes backend↔frontend route drift by reusing `orchestration/bin/lib/graph.ts` (`extractRoutes`/`extractCalls`/`gapAnalysis`). `analyzeCompletion` turns those facts into gaps — each with a severity (P1/P2/P3), the owning fleet stream (`mjs-migration`, `typescript-core`, …), and a justification — and writes `orchestration/COMPLETION_GAPS.md`:
- **§A** language breakdown (TS primary; note tests are centralized under `tests/` so a lane without co-located tests is NOT a coverage gap),
- **§B** missing code (route drift + stub markers),
- **§C** missing/sparse folders (SUSPECTED — verify intent, never asserted-missing),
- **§D** missing/under-migrated languages (the `.mjs → .ts` migration backlog, per directory),
- **§E** task distribution per fleet stream, ≤2/model.

Evidence only, no guessing. This is the deterministic layer of the council's collective scan (alongside FLEET_RUN.md 6/6 and CODINGS_STATUS.md). `--json` for structured output. See `.claude/BRAIN.md`.
