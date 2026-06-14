#!/bin/bash
# LLM Mission Control'ü durdurur: container down + host bridge kill.
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

printf '\033[36m[down]\033[0m container durduruluyor...\n'
docker compose down >/dev/null 2>&1 || true

PID_FILE="$HOME/.llm-mission-control/bridge.pid"
if [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  printf '\033[36m[down]\033[0m bridge durduruldu (pid %s).\n' "$(cat "$PID_FILE")"
fi
printf '\033[32m[down] DURDU\033[0m\n'
