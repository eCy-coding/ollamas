#!/bin/bash
# LLM Mission Control'ü durdurur: container down + host bridge kill.
# DRY_RUN=1 → yan etki yok, komutları [DRY] olarak yazar (prova/test).
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
DRY_RUN="${DRY_RUN:-0}"
# Gate a side-effecting command behind DRY_RUN (echo instead of execute).
run() {
  if [ "$DRY_RUN" = "1" ]; then printf '\033[35m[DRY]\033[0m would run: %s\n' "$*"; else "$@"; fi
}

printf '\033[36m[down]\033[0m container durduruluyor...\n'
run docker compose down || true

PID_FILE="$HOME/.llm-mission-control/bridge.pid"
if [ "$DRY_RUN" = "1" ]; then
  printf '\033[35m[DRY]\033[0m would kill bridge pid from %s\n' "$PID_FILE"
elif [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  printf '\033[36m[down]\033[0m bridge durduruldu (pid %s).\n' "$(cat "$PID_FILE")"
fi
printf '\033[32m[down] DURDU\033[0m\n'
