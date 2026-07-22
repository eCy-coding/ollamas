#!/bin/zsh
# e2e self-heal watchdog — runs the unified e2e gate and, ONLY after a leg has been red
# for N consecutive runs (debounce against transient restarts), kickstarts the specific
# down service and notifies. Green run -> reset counters + write a heartbeat.
#
# Churn-safety: the :3000 hub is NEVER auto-kickstarted from here (it has its own
# KeepAlive; hard-kicking it was the original churn bug). Only self-contained, safe-to-
# restart companions are healed automatically. Everything else is notify-only.
set -u
# Overridable so the watchdog can be exercised from a worktree without pointing at the
# checkout launchd happens to run against.
REPO="${OLLAMAS_REPO:-$HOME/Desktop/ollamas}"
STATE="$HOME/.llm-mission-control/e2e-watchdog-state.json"
HEARTBEAT="$HOME/.llm-mission-control/e2e-gate-heartbeat.json"
cd "$REPO" || exit 0

OUT="$(npx tsx scripts/e2e-gate.ts 2>/dev/null)"
GREEN="$(printf '%s' "$OUT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["green"])' 2>/dev/null)"
RED="$(printf '%s' "$OUT" | python3 -c 'import json,sys;print(" ".join(json.load(sys.stdin)["red"]))' 2>/dev/null)"

notify(){ osascript -e "display notification \"$1\" with title \"ollamas e2e watchdog\"" >/dev/null 2>&1; }

if [ "$GREEN" = "True" ]; then
  printf '{"green":true,"ts":%s}\n' "$(date +%s)000" > "$HEARTBEAT"
  echo '{}' > "$STATE"
  exit 0
fi

# The counting + restart decision lives in server/e2e-watchdog-policy.ts (pure, tested in
# tests/e2e-watchdog-policy.test.ts). It also owns the check -> launchd label map, so the
# hub / ollama / chroma stay notify-only exactly as before.
#
# The decision it adds over the old inline shell: after a service is kickstarted, it gets a
# grace window to finish booting before it can be kickstarted again. Without it, odysseus
# (~210s to bind :7860, measured) was re-killed every 300s gate run and could never reach
# green — the healer was causing the "odysseus :7860 intermittent" outage it was reacting to.
uid="$(id -u)"
ACTIONS="$(npx tsx scripts/e2e-watchdog-decide.ts "$STATE" ${(s: :)RED} 2>/dev/null)"

printf '%s\n' "$ACTIONS" | while IFS=' ' read -r kind a b c; do
  case "$kind" in
    kick)   launchctl kickstart -k "gui/$uid/$a" 2>/dev/null \
              && notify "self-heal: restarted $a (red x$c on $b)" ;;
    notify) notify "e2e RED x$b on $a (notify-only, no auto-restart)" ;;
  esac
done
exit 1
