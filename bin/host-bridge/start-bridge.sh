#!/bin/bash
# Start the macOS terminal bridge in the background (host-side).
# Generates/reuses a shared token, writes pid + log under ~/.llm-mission-control.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STATE="$HOME/.llm-mission-control"
mkdir -p "$STATE"
TOKEN_FILE="$STATE/bridge.token"
PID_FILE="$STATE/bridge.pid"
LOG_FILE="$STATE/bridge.log"

# reuse existing token or generate one
if [ ! -s "$TOKEN_FILE" ]; then
  openssl rand -hex 16 >"$TOKEN_FILE"
fi
TOKEN="$(cat "$TOKEN_FILE")"

# stop a previous instance if running
if [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[bridge] stopping previous pid $(cat "$PID_FILE")"
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  sleep 1
fi

# Ecosystem write-roots (owner-authorized): the dirs ollamas/odysseus need to
# self-improve. NOT ~/ home (financial/key files stay off-limits to --yolo agents).
# Override with BRIDGE_WRITE_ROOTS=... to widen/narrow.
DEFAULT_ROOTS="$HOME/Desktop/ollamas:$HOME/ollamas-odysseus-orchestrator:$HOME/pinokio/api/odysseus.pinokio.git:$HOME/khoj-secondbrain:$HOME/.local/bin:$HOME/.ollamas:$HOME/.llm-mission-control:/tmp/llm-bridge"
HOST_BRIDGE_TOKEN="$TOKEN" PORT="${PORT:-7345}" BRIDGE_WRITE_ROOTS="${BRIDGE_WRITE_ROOTS:-$DEFAULT_ROOTS}" \
  nohup node "$DIR/terminal-bridge.mjs" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 1

echo "[bridge] started pid $(cat "$PID_FILE") | log: $LOG_FILE"
echo "[bridge] token file: $TOKEN_FILE"
curl -fs "http://127.0.0.1:${PORT:-7345}/health" && echo
