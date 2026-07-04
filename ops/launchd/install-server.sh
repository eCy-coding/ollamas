#!/bin/bash
# ops/launchd/install-server.sh — one-command install of the always-running :3000 LaunchAgent.
# This is the SINGLE operator-privileged step for 0-manual sustained operation: after this the
# server (and its key-health autonomy loop) restart on login and on crash with no further action.
# Idempotent: reload-safe. Run once; everything after is automatic.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST="com.ollamas.server.plist"
SRC="$REPO/ops/launchd/$PLIST"
DEST="$HOME/Library/LaunchAgents/$PLIST"

[ -f "$SRC" ] || { echo "[install] missing $SRC" >&2; exit 1; }

# Guard: a foreground dev server on :3000 would collide with the daemon's bind.
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[install] WARNING: something is already listening on :3000 — stop it first, or the"
  echo "          daemon will EADDRINUSE-thrash. (This is the only manual heads-up.)"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.llm-mission-control"
cp "$SRC" "$DEST"
launchctl unload "$DEST" 2>/dev/null || true
launchctl load -w "$DEST"

echo "[install] loaded $PLIST"
echo "[install] status:  launchctl list | grep ollamas.server"
echo "[install] log:     tail -f ~/.llm-mission-control/server.log"
echo "[install] stop:    launchctl unload $DEST"
