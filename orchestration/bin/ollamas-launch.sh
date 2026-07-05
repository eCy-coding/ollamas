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

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  conductor|watch)  exec "$TSX" "$CONDUCTOR" --watch "${2:-600}" ;;
  *)                cli "$@" ;;
esac
