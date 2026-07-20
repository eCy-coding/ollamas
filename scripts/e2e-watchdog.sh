#!/bin/zsh
# e2e self-heal watchdog — runs the unified e2e gate and, ONLY after a leg has been red
# for N consecutive runs (debounce against transient restarts), kickstarts the specific
# down service and notifies. Green run -> reset counters + write a heartbeat.
#
# Churn-safety: the :3000 hub is NEVER auto-kickstarted from here (it has its own
# KeepAlive; hard-kicking it was the original churn bug). Only self-contained, safe-to-
# restart companions are healed automatically. Everything else is notify-only.
set -u
REPO="$HOME/Desktop/ollamas"
STATE="$HOME/.llm-mission-control/e2e-watchdog-state.json"
HEARTBEAT="$HOME/.llm-mission-control/e2e-gate-heartbeat.json"
THRESH=3
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

# map a red check -> a safe launchd label to kickstart (hub/ollama/chroma = notify-only)
label_for(){ case "$1" in
  odysseus-bridge) echo "com.odysseus.server" ;;
  pulse:4777)      echo "com.ody.pulse" ;;
  brain|brain-loop-fresh) echo "com.ollamas.brain-loop" ;;
  obsidian)        echo "com.ollamas.brain-obsidian-sync" ;;
  *) echo "" ;; esac }

uid="$(id -u)"
prev="$(cat "$STATE" 2>/dev/null || echo '{}')"
newstate="{"
for chk in ${(s: :)RED}; do
  n="$(printf '%s' "$prev" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$chk',0))" 2>/dev/null || echo 0)"
  n=$((n+1))
  newstate="$newstate\"$chk\":$n,"
  if [ "$n" -ge "$THRESH" ]; then
    lbl="$(label_for "$chk")"
    if [ -n "$lbl" ]; then
      launchctl kickstart -k "gui/$uid/$lbl" 2>/dev/null && notify "self-heal: restarted $lbl (red x$n on $chk)"
      newstate="${newstate%,}"; newstate="$newstate," # keep, counter resets next green
    else
      notify "e2e RED x$n on $chk (notify-only, no auto-restart)"
    fi
  fi
done
newstate="${newstate%,}}"
[ "$newstate" = "}" ] && newstate="{}"
printf '%s\n' "$newstate" > "$STATE"
exit 1
