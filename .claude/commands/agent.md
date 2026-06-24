---
description: Dispatch a task to the local ollamas ReAct sub-agent (Tier-3, zero API cost)
argument-hint: <task description>
allowed-tools: Bash(node scripts/agent-dispatch.mjs:*), Bash(npm run agent:*)
---
Dispatch this task to the local ollamas sub-agent and report back its structured result (the per-step tools, files written, and the final `VERDICT:` line):

Run: `node scripts/agent-dispatch.mjs "$ARGUMENTS"`

If `$ARGUMENTS` is empty, ask what task to dispatch instead of running. If the dispatch reports `demoSuspected` or a non-real provider, flag it — a real (non-demo) provider must have served the run.
