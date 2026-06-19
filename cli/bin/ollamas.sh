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

# curl with a conditional Bearer header (E-005): the token must be passed as a
# real argument, never via an unquoted var — `-H "Authorization: Bearer $KEY"`
# stored in a plain var word-splits on the space in "Bearer KEY" and truncates
# the header to "Bearer". Prepending args with set/inline call keeps it intact.
ocurl() {
  if [ -n "${OLLAMAS_API_KEY:-}" ]; then
    curl -fsS -H "Authorization: Bearer ${OLLAMAS_API_KEY}" "$@"
  else
    curl -fsS "$@"
  fi
}
# ocurl + conditional admin header, for the saas reads only.
ocurl_admin() {
  if [ -n "${OLLAMAS_SAAS_ADMIN:-}" ]; then
    ocurl -H "X-Admin-Token: ${OLLAMAS_SAAS_ADMIN}" "$@"
  else
    ocurl "$@"
  fi
}

cmd="${1:-help}"
[ $# -gt 0 ] && shift || true

# JSON-escape a string (backslash + double-quote) via a tiny awk pass.
esc() { printf '%s' "$1" | awk 'BEGIN{ORS=""} {gsub(/\\/,"\\\\");gsub(/"/,"\\\"");print} END{print ""}'; }

case "$cmd" in
  doctor)
    ocurl "$GATEWAY/api/health" || { echo "gateway down: $GATEWAY" >&2; exit 1; }
    echo
    ;;
  chat)
    prompt="$*"
    [ -n "$prompt" ] || { echo "usage: ollamas.sh chat \"prompt\"" >&2; exit 2; }
    body=$(printf '{"provider":"%s","model":"%s","stream":false,"messages":[{"role":"user","content":"%s"}]}' \
      "$PROVIDER" "$MODEL" "$(esc "$prompt")")
    ocurl -H "Content-Type: application/json" -d "$body" "$GATEWAY/api/generate"
    echo
    ;;
  agent)
    task="$*"
    [ -n "$task" ] || { echo "usage: ollamas.sh agent \"task\"" >&2; exit 2; }
    # auto-apply on the bridge path (no TTY for approval); raw SSE -> stdout.
    body=$(printf '{"provider":"%s","model":"%s","autoApply":true,"messages":[{"role":"user","content":"%s"}]}' \
      "$PROVIDER" "$MODEL" "$(esc "$task")")
    ocurl -N -H "Content-Type: application/json" -d "$body" "$GATEWAY/api/agent/chat"
    echo
    ;;
  mcp)
    # MCP over the gateway choke-point (/mcp, JSON-RPC 2.0, Streamable HTTP) for
    # tools/call; upstream registry is plain REST (/api/saas/upstreams, Bearer).
    #   ollamas.sh mcp tools                       list tool names
    #   ollamas.sh mcp call <tool> '{json}'        call a tool with JSON args
    #   ollamas.sh mcp upstreams                   list registered upstream servers
    #   ollamas.sh mcp add <name> <http|stdio> <url> [allowCsv]
    #   ollamas.sh mcp rm <id>
    # tools/call response is SSE-framed (`data: {…}`); strip the prefix to raw JSON.
    sub="${1:-tools}"
    [ $# -gt 0 ] && shift || true
    case "$sub" in
      upstreams)
        ocurl "$GATEWAY/api/saas/upstreams" || { echo "upstreams request failed" >&2; exit 1; }
        echo; exit 0 ;;
      add)
        name="${1:-}"; transport="${2:-}"; url="${3:-}"; allow="${4:-}"
        [ -n "$name" ] && [ -n "$transport" ] || { echo "usage: ollamas.sh mcp add <name> <http|stdio> <url> [allowCsv]" >&2; exit 2; }
        allowJson="null"
        [ -n "$allow" ] && allowJson=$(printf '%s' "$allow" | awk -F, '{o="[";for(i=1;i<=NF;i++)o=o (i>1?",":"") "\"" $i "\"";print o"]"}')
        body=$(printf '{"name":"%s","transport":"%s","url":"%s","allowedTools":%s}' \
          "$(esc "$name")" "$(esc "$transport")" "$(esc "$url")" "$allowJson")
        ocurl -H "Content-Type: application/json" -d "$body" "$GATEWAY/api/saas/upstreams" \
          || { echo "add request failed" >&2; exit 1; }
        echo; exit 0 ;;
      rm)
        id="${1:-}"; [ -n "$id" ] || { echo "usage: ollamas.sh mcp rm <id>" >&2; exit 2; }
        ocurl -X DELETE "$GATEWAY/api/saas/upstreams/$id" \
          || { echo "rm request failed" >&2; exit 1; }
        echo; exit 0 ;;
      tools)
        rpc='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
        ;;
      call)
        tool="${1:-}"; [ -n "$tool" ] || { echo "usage: ollamas.sh mcp call <tool> '{json}'" >&2; exit 2; }
        args="${2:-{}}"
        rpc=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$(esc "$tool")" "$args")
        ;;
      *) echo "ollamas.sh mcp: unknown sub '$sub' (tools|call|upstreams|add|rm)" >&2; exit 2 ;;
    esac
    ocurl -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
      -d "$rpc" "$GATEWAY/mcp" | sed 's/^data: //;/^event:/d;/^$/d'
    echo
    ;;
  saas)
    # SaaS admin reads over the gateway (X-Admin-Token via OLLAMAS_SAAS_ADMIN).
    # Read-only on the bridge — provisioning/billing stays in the Node CLI.
    #   ollamas.sh saas plans | tenants | usage [tenantId]
    sub="${1:-plans}"
    [ $# -gt 0 ] && shift || true
    case "$sub" in
      plans)   path="/api/saas/plans" ;;
      tenants) path="/api/saas/tenants" ;;
      usage)   tid="${1:-}"; path="/api/saas/usage${tid:+?tenantId=$tid}" ;;
      *) echo "ollamas.sh saas: unknown sub '$sub' (plans|tenants|usage)" >&2; exit 2 ;;
    esac
    ocurl_admin "$GATEWAY$path" || { echo "saas request failed (admin token? OLLAMAS_SAAS_ADMIN)" >&2; exit 1; }
    echo
    ;;
  help|--help|-h)
    echo "ollamas.sh <doctor|chat|agent|mcp|saas> — POSIX curl bridge to $GATEWAY"
    echo "  mcp  tools|call|upstreams|add|rm     saas  plans|tenants|usage"
    ;;
  *)
    echo "ollamas.sh: unknown command '$cmd' (doctor|chat|agent|mcp|saas|help)" >&2
    exit 2
    ;;
esac
