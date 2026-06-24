---
description: ollamas health — deterministic monitor first, escalate to fleet only on failure
allowed-tools: Bash(npm run ops:*), Bash(node scripts/ops.mjs:*)
---
Run `npm run ops`. This runs the deterministic system-monitor first (fast, no LLM — "silence = success") and only escalates to the agent fleet on a real FAIL. Report: all-pass if healthy, otherwise the FAIL findings and their ground-truth-cross-checked verdict. Add `-- --deep` only if the user asks for continuous-inspection mode.
