#!/usr/bin/env bash
# orchestration/bin/ollamas-boot.sh — JUstdoit STEP 10: one command brings the WHOLE project up end-to-end
# and launches the $0 Claude-Code-free conductor in living Terminal.app + iTerm2 tabs.
#
# Flow (Emre 4-step): (1) boot infra via ./start.sh (ollama serve + warm + host bridge + gate),
# (2) open a persistent tab in EACH available terminal running `orchestra.ts --watch` (the conductor
# dispatches/supervises/repairs), (3+4) the conductor's FSM does benchmark-validate → surgical repair.
#
# Usage:  ollamas-boot.sh [--no-tabs] [--watch-sec N] [--dry]
#   --no-tabs   boot + run ONE conductor tick inline (no new terminal windows) — good for CI/headless
#   --dry       print what would run; mutate nothing (no boot, no tabs)
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"  # resolve symlinks → real script dir (PATH-symlink safe)
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [ "${SOURCE#/}" = "$SOURCE" ] && SOURCE="$DIR/$SOURCE"
done
HERE="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TSX="$REPO/node_modules/.bin/tsx"
CONDUCTOR="$HERE/orchestra.ts"
WATCH_SEC="600"
DRY=0; NO_TABS=0; NO_READY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-tabs) NO_TABS=1 ;;
    --no-ready) NO_READY=1 ;;
    --dry) DRY=1 ;;
    --watch-sec) WATCH_SEC="${2:-600}"; shift ;;
    *) ;;
  esac
  shift
done

say() { printf '\033[36m[ollamas]\033[0m %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '\033[35m[DRY]\033[0m %s\n' "$*"; else eval "$*"; fi; }

# 0) PREFLIGHT self-heal (0-manual): detect + auto-fix missing prereqs (ollama/model/deps) BEFORE boot so
#    start.sh never fails on a fixable prerequisite. Best-effort — never blocks (--no-ready to skip).
if [ "$NO_READY" != 1 ] && [ -f "$REPO/scripts/ready.mjs" ]; then
  say "STEP 0 · preflight self-heal (npm run ready)…"
  run "(cd '$REPO' && npm run ready) || true"
fi

# 1) BOOT infra (idempotent; start.sh already guards ports + ollama + bridge). Best-effort: a degraded
#    boot must NOT block the conductor (it self-heals + fails over).
say "STEP 1/2 · infra boot (start.sh)…"
if [ -x "$REPO/start.sh" ] || [ -f "$REPO/start.sh" ]; then
  run "bash '$REPO/start.sh' || true"
else
  say "start.sh yok — degraded boot (conductor yine de ayağa kalkar)"
fi

# 2) CONDUCTOR — living tabs in every available terminal, else one inline tick.
# Write the conductor command to a tiny launch script so the AppleScript `do script`/`write text` payload is
# a single bare path with NO nested quotes (the classic osascript quoting trap → parse failure at runtime).
TABSH="$HOME/.ollamas/conductor-tab.sh"
write_tabsh() {
  run "mkdir -p '$HOME/.ollamas'"
  if [ "$DRY" = 1 ]; then printf '\033[35m[DRY]\033[0m write %s → tsx orchestra.ts --watch %s\n' "$TABSH" "$WATCH_SEC"; return; fi
  printf '#!/usr/bin/env bash\ncd %q && exec %q %q --watch %s\n' "$REPO" "$TSX" "$CONDUCTOR" "$WATCH_SEC" > "$TABSH"
  chmod +x "$TABSH"
}

launch_tabs() {
  write_tabsh
  local launched=0
  # Terminal.app — `do script` in a new tab/window running the bare launch-script path.
  if [ -d "/System/Applications/Utilities/Terminal.app" ] || [ -d "/Applications/Utilities/Terminal.app" ]; then
    run "osascript -e 'tell application \"Terminal\" to do script \"bash $TABSH\"' >/dev/null 2>&1 || true"
    say "🎼 Terminal.app tab → conductor --watch"; launched=1
  fi
  # iTerm2 — new tab in current window (or a fresh window), running the bare launch-script path.
  if [ -d "/Applications/iTerm.app" ]; then
    run "osascript -e 'tell application \"iTerm\"' -e 'activate' -e 'if (count of windows) = 0 then' -e 'create window with default profile' -e 'else' -e 'tell current window to create tab with default profile' -e 'end if' -e 'tell current session of current window to write text \"bash $TABSH\"' -e 'end tell' >/dev/null 2>&1 || true"
    say "🎼 iTerm2 tab → conductor --watch"; launched=1
  fi
  return $((launched == 1 ? 0 : 1))
}

if [ "$NO_TABS" = 1 ]; then
  say "STEP 2/2 · --no-tabs → one inline conductor tick"
  run "'$TSX' '$CONDUCTOR' --once"
else
  say "STEP 2/2 · conductor living-tabs (Terminal.app + iTerm2)…"
  if ! launch_tabs; then
    say "hiçbir terminal app yok → inline tick"
    run "'$TSX' '$CONDUCTOR' --once"
  fi
fi
say "✅ ollamas ayakta — \$0 yerel şef canlı (state: ~/.ollamas/orchestra.json · log: ~/.ollamas/orchestra.log)"
