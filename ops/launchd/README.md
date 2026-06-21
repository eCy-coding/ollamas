# ollamas system-monitor heartbeat (launchd)

Sustainable, deterministic self-monitor. Runs `scripts/system-monitor.mjs --heartbeat`
every 15 min via launchd. **No LLM** — pure invariant checks (~3s). Appends each run to a
JSONL learning ledger and self-baselines; on a change/FAIL it logs the delta + a ready
sub-agent escalation command. "Silence = Success" (quiet when nothing changed).

## Install
```sh
cp ops/launchd/com.ecypro.ollamas-monitor.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.ecypro.ollamas-monitor.plist 2>/dev/null
launchctl load -w ~/Library/LaunchAgents/com.ecypro.ollamas-monitor.plist
```
The `<string>` node path in the plist is machine-specific (mise). If `which node` changes,
update it and reload.

## Use
- **Status:**  `launchctl list | grep ollamas-monitor`  (3rd col = last exit code, 0 = ok)
- **Problems:** `tail -f ~/.llm-mission-control/monitor-heartbeat.log` (empty = all healthy)
- **History/learning store:** `~/.llm-mission-control/monitor-history.jsonl`
- **Run now:** `launchctl kickstart -k gui/$(id -u)/com.ecypro.ollamas-monitor`
- **On a FAIL line:** run the escalation command the log prints (qwen3:8b investigates).
- **Stop:** `launchctl unload ~/Library/LaunchAgents/com.ecypro.ollamas-monitor.plist`

## Manual heartbeat (no launchd)
```sh
node scripts/system-monitor.mjs --heartbeat      # silent unless something changed
node scripts/system-monitor.mjs                  # full PASS/FAIL table (one-shot)
node scripts/system-monitor.mjs --json           # machine-readable
```
