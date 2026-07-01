---
description: Run the THINK loop — map live findings (critic/dod/requirements/fleet) to PROVEN, cited solutions from PROBLEM_REGISTRY.json; unknown problems flagged NEEDS_RESEARCH (never guesses).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/think.ts:*), Bash(npx tsx orchestration/bin/think.ts:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/think.ts`. It reads the current findings and writes `orchestration/THINK.md`. Report the counts (PROVEN vs NEEDS_RESEARCH). For each PROVEN problem give the cited solution; for each NEEDS_RESEARCH problem, the rule is: research ≥2 authoritative sources, verify, then append the fix to `orchestration/PROBLEM_REGISTRY.json` (the mechanism LEARNS). Never invent a fix without a source. See `.claude/BRAIN.md`.
