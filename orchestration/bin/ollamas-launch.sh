#!/usr/bin/env bash
# orchestration/bin/ollamas-launch.sh — the global `ollamas` command dispatcher (symlink target).
#
# Routes the single word `ollamas` (JUstdoit STEP 10) to the right surface:
#   ollamas              → boot the whole project + living conductor tabs (STEP 1-9)
#   ollamas up | boot    → same as bare
#   ollamas do <task…>   → enqueue a task into the running conductor (Emre 4-step dispatch)
#   ollamas status       → print conductor FSM state one-liner
#   ollamas <anything>   → delegate to the existing zero-dep TS CLI (chat/agent/mcp/keys/…)
set -euo pipefail

# Resolve symlinks so HERE is the REAL dir of this script even when invoked via a PATH symlink
# (e.g. ~/.local/bin/ollamas → …/orchestration/bin/ollamas-launch.sh). Without this, BASH_SOURCE is the
# symlink and REPO mis-resolves to ~ → `tsx not found`.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [ "${SOURCE#/}" = "$SOURCE" ] && SOURCE="$DIR/$SOURCE"
done
HERE="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TSX="$REPO/node_modules/.bin/tsx"
CONDUCTOR="$HERE/orchestra.ts"

cli() { # prefer a built native binary if present, else tsx the source (zero-dep CLI lane)
  local bin="$REPO/dist/ollamas-darwin-arm64"
  if [ -x "$bin" ]; then exec "$bin" "$@"; else exec "$TSX" "$REPO/cli/index.ts" "$@"; fi
}

case "${1:-}" in
  ""|up|boot)       exec bash "$HERE/ollamas-boot.sh" "${@:2}" ;;
  do)               exec "$TSX" "$CONDUCTOR" "${*:2}" ;;   # enqueue the rest as one task string
  status)           exec "$TSX" "$CONDUCTOR" --status ;;
  tasks)            [ "${2:-}" = "--progress" ] && exec "$TSX" "$CONDUCTOR" --progress || exec "$TSX" "$CONDUCTOR" --tasks ;;
  progress)         exec "$TSX" "$CONDUCTOR" --progress ;;  # X/N completion + per-lane breakdown
  calibrate)        exec "$TSX" "$HERE/calibrate.ts" "${@:2}" ;;    # e2e pipeline calibration
  deps)             exec "$TSX" "$HERE/deps-doctor.ts" "${@:2}" ;;  # brew/macOS dependency check
  ready)            cd "$REPO" && exec npm run ready ;;    # preflight self-heal (scripts/ready.mjs)
  conductor|watch)  exec "$TSX" "$CONDUCTOR" --watch "${2:-600}" ;;
  *)                cli "$@" ;;
esac
