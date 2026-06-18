#!/usr/bin/env sh
# ollamas.sh — zero-runtime POSIX/curl bridge for SSH/iSH where Node is absent.
# Same gateway HTTP API as the Node CLI. Hybrid surface (see cli/ROADMAP.md v1/v6).
#
#   ollamas.sh doctor
#   ollamas.sh chat "why is the sky blue"
#
# Config via env: OLLAMAS_GATEWAY (default http://localhost:3000), OLLAMAS_API_KEY,
# OLLAMAS_MODEL (default qwen3:8b), OLLAMAS_PROVIDER (default ollama-local).
set -eu

GATEWAY="${OLLAMAS_GATEWAY:-http://localhost:3000}"
MODEL="${OLLAMAS_MODEL:-qwen3:8b}"
PROVIDER="${OLLAMAS_PROVIDER:-ollama-local}"
AUTH=""
[ -n "${OLLAMAS_API_KEY:-}" ] && AUTH="-H Authorization:Bearer ${OLLAMAS_API_KEY}"

cmd="${1:-help}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  doctor)
    # shellcheck disable=SC2086
    curl -fsS $AUTH "$GATEWAY/api/health" || { echo "gateway down: $GATEWAY" >&2; exit 1; }
    echo
    ;;
  chat)
    prompt="$*"
    [ -n "$prompt" ] || { echo "usage: ollamas.sh chat \"prompt\"" >&2; exit 2; }
    # JSON-escape the prompt (quotes, backslashes, newlines) via a tiny awk pass.
    esc=$(printf '%s' "$prompt" | awk 'BEGIN{ORS=""} {gsub(/\\/,"\\\\");gsub(/"/,"\\\"");print} END{print ""}')
    body=$(printf '{"provider":"%s","model":"%s","stream":false,"messages":[{"role":"user","content":"%s"}]}' \
      "$PROVIDER" "$MODEL" "$esc")
    # shellcheck disable=SC2086
    curl -fsS $AUTH -H "Content-Type: application/json" -d "$body" "$GATEWAY/api/generate"
    echo
    ;;
  help|--help|-h)
    echo "ollamas.sh <doctor|chat> — POSIX curl bridge to $GATEWAY"
    ;;
  *)
    echo "ollamas.sh: unknown command '$cmd' (doctor|chat|help)" >&2
    exit 2
    ;;
esac
