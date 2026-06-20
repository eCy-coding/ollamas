#!/bin/bash
# Install the host terminal-bridge as a macOS LaunchAgent so it survives reboot
# (scripts lane, v16). Idempotent: re-running re-renders the plist and reloads.
# DRY_RUN=1 prints mutations as [DRY] without touching the system (test/rehearsal).
# Token is reused from ~/.llm-mission-control/bridge.token (start-bridge.sh pattern).
set -euo pipefail
DRY_RUN="${DRY_RUN:-0}"

run() { if [ "$DRY_RUN" = "1" ]; then printf '\033[35m[DRY]\033[0m would run: %s\n' "$*"; else "$@"; fi; }

DIR="$(cd "$(dirname "$0")" && pwd)" # bin/host-bridge
REPO="$(cd "$DIR/../.." && pwd)"     # worktree root
LABEL="com.missioncontrol.terminalbridge"
STATE="$HOME/.llm-mission-control"
TOKEN_FILE="$STATE/bridge.token"
LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/$LABEL.plist"
PORT="${PORT:-7345}"
GUI="gui/$(id -u)"

if ! command -v launchctl >/dev/null 2>&1; then
  echo "[-] launchctl not found — LaunchAgent install is macOS-only."
  exit 1
fi
NODE="$(command -v node || true)"
[ -n "$NODE" ] || {
  echo "[-] node not found on PATH"
  exit 1
}

# 1. Ensure the shared token (reuse if present, else generate; start-bridge.sh parity).
run mkdir -p "$STATE"
if [ ! -s "$TOKEN_FILE" ]; then
  run bash -c "umask 077; openssl rand -hex 16 > \"$TOKEN_FILE\""
fi
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || echo DRY_PLACEHOLDER_TOKEN)"

# 2. Render the plist with this machine's node/repo/token/port, write 0600 (token inside).
run mkdir -p "$LA_DIR"
if [ "$DRY_RUN" = "1" ]; then
  printf '\033[35m[DRY]\033[0m would render plist -> %s (node=%s repo=%s port=%s) chmod 600\n' "$PLIST" "$NODE" "$REPO" "$PORT"
else
  node "$DIR/render-plist.mjs" "$REPO" "$TOKEN" "$NODE" "$PORT" >"$PLIST"
  chmod 600 "$PLIST"
fi

# 3. (Re)load the agent — bootout first for idempotency, then bootstrap+enable+kickstart.
run launchctl bootout "$GUI/$LABEL" || true
run launchctl bootstrap "$GUI" "$PLIST"
run launchctl enable "$GUI/$LABEL"
run launchctl kickstart -k "$GUI/$LABEL"

echo "[+] LaunchAgent installed: $LABEL on port $PORT (survives reboot)."
echo "    plist: $PLIST"
