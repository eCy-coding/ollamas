---
description: Kill-switch for the model-fleet — release all work claims so no worker keeps running. "Sürdürülebilir" ≠ "unstoppable".
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/fleet-conduct.ts --stop:*), Bash(npx tsx orchestration/bin/fleet-conduct.ts --stop:*), Bash(pkill:*)
---
Run `./node_modules/.bin/tsx orchestration/bin/fleet-conduct.ts --stop` to release every active claim, then `pkill -f "fleet-agent.ts"` to stop the persistent agent processes. Report how many claims were released and confirm no fleet-agent processes remain.
