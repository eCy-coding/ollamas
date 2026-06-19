#!/usr/bin/env sh
# ollamas.sh — zero-runtime POSIX/curl bridge for SSH/iSH where Node is absent.
# Same gateway HTTP API as the Node CLI. Hybrid surface (see cli/ROADMAP.md v1/v6).
#
#   ollamas.sh doctor
#   ollamas.sh chat "why is the sky blue"
#   ollamas.sh agent "list files and run tests"   (auto-apply writes; SSE -> stdout)
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

# JSON-escape a string (backslash + double-quote) via a tiny awk pass.
esc() { printf '%s' "$1" | awk 'BEGIN{ORS=""} {gsub(/\\/,"\\\\");gsub(/"/,"\\\"");print} END{print ""}'; }

case "$cmd" in
  doctor)
    # shellcheck disable=SC2086
    curl -fsS $AUTH "$GATEWAY/api/health" || { echo "gateway down: $GATEWAY" >&2; exit 1; }
    echo
    ;;
  chat)
    prompt="$*"
    [ -n "$prompt" ] || { echo "usage: ollamas.sh chat \"prompt\"" >&2; exit 2; }
    body=$(printf '{"provider":"%s","model":"%s","stream":false,"messages":[{"role":"user","content":"%s"}]}' \
      "$PROVIDER" "$MODEL" "$(esc "$prompt")")
    # shellcheck disable=SC2086
    curl -fsS $AUTH -H "Content-Type: application/json" -d "$body" "$GATEWAY/api/generate"
    echo
    ;;
  agent)
    task="$*"
    [ -n "$task" ] || { echo "usage: ollamas.sh agent \"task\"" >&2; exit 2; }
    # auto-apply on the bridge path (no TTY for approval); raw SSE -> stdout.
    body=$(printf '{"provider":"%s","model":"%s","autoApply":true,"messages":[{"role":"user","content":"%s"}]}' \
      "$PROVIDER" "$MODEL" "$(esc "$task")")
    # shellcheck disable=SC2086
    curl -fsS -N $AUTH -H "Content-Type: application/json" -d "$body" "$GATEWAY/api/agent/chat"
    echo
    ;;
  mcp)
    # MCP over the gateway choke-point (/mcp, JSON-RPC 2.0, Streamable HTTP).
    #   ollamas.sh mcp tools                 list tool names
    #   ollamas.sh mcp call <tool> '{json}'  call a tool with JSON args
    # Response is SSE-framed (`data: {…}`); strip the prefix to raw JSON.
    sub="${1:-tools}"
    [ $# -gt 0 ] && shift || true
    case "$sub" in
      tools)
        rpc='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
        ;;
      call)
        tool="${1:-}"; [ -n "$tool" ] || { echo "usage: ollamas.sh mcp call <tool> '{json}'" >&2; exit 2; }
        args="${2:-{}}"
        rpc=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$(esc "$tool")" "$args")
        ;;
      *) echo "ollamas.sh mcp: unknown sub '$sub' (tools|call)" >&2; exit 2 ;;
    esac
    # shellcheck disable=SC2086
    curl -fsS $AUTH -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
      -d "$rpc" "$GATEWAY/mcp" | sed 's/^data: //;/^event:/d;/^$/d'
    echo
    ;;
  help|--help|-h)
    echo "ollamas.sh <doctor|chat|agent|mcp> — POSIX curl bridge to $GATEWAY"
    ;;
  *)
    echo "ollamas.sh: unknown command '$cmd' (doctor|chat|agent|mcp|help)" >&2
    exit 2
    ;;
esac
