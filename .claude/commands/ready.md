---
description: ollamas instant-on — detect + safely auto-fix prerequisites, report readiness
allowed-tools: Bash(npm run ready:*), Bash(node scripts/ready.mjs:*)
---
Run `npm run ready` from the repo root. Report the readiness table verbatim, then state in one line whether ollamas is ready to dispatch agents and the single next command to run (start the server, pull the model, or start ollama) if anything is blocking.
