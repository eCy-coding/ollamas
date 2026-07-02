---
description: Turn the completion-gap report (COMPLETION_GAPS.json) into a step-by-step, section-by-section build PLAN — dependency-ordered phases (fleet-stream DAG, foundation first), gaps within a phase by severity, each with a fast/safe/correct recipe (approach + steps + verify) → orchestration/BUILD_PLAN.md. This is a PLAN; it reads JSON and writes markdown, it builds nothing.
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/build-plan.ts:*), Bash(npx tsx orchestration/bin/build-plan.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/build-plan.ts`. It reads `orchestration/COMPLETION_GAPS.json` (from `/completion-scan`), orders the owning fleet streams by the `DEFAULT_DEPS` dependency DAG (shell-harden → mjs-migration → typescript-core → {errors-resilience, concurrency-safety} → test-coverage, reusing `mission.topoSort`), makes one phase per stream, orders the gaps within each phase by severity (P1 → P3), and attaches a build recipe per gap kind:
- **language-migration** (.mjs→.ts): incremental, behavior-preserving, per-file typed + `tsc`-gated, batched by directory — never big-bang.
- **route-missing**: verify the call is real (not a URL-concat artifact) first, then implement a validated Express handler + test.
- **route-unused**: confirm no external consumer (public/webhook/CLI) before removing; else document.
- **stub**: read the marker context (some are grep-arg false positives), implement the real ones + test.
- **sparse-folder**: verify intent — document a placeholder or scope a real completion lane; never fabricate code.

Writes `orchestration/BUILD_PLAN.md` (T1→Tn sections, each step with approach + verify + why) + `.json`. Fastest = reuse adjacent patterns; Safest = verify-before-touch, test-first; Correct = typed + gated each step. Flags: `--from <json>`, `--json`. Run `/completion-scan` first if the JSON is missing. See `.claude/BRAIN.md`.
