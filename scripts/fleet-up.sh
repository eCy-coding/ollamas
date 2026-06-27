#!/bin/bash
# fleet-up.sh — Mac control-plane one-command fleet bringup (idempotent).
#   ./scripts/fleet-up.sh
# ready(detect+fix) -> tailscale check -> remote discover (auto-pool) ->
# remote up --watch (priority failover supervisor). Re-run = green no-op.
# Pairs with scripts/fleet-join.ps1 (run once on each Windows GPU worker).
# DRY_RUN=1 → no supervisor launch; mutating steps print [DRY].
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
DRY_RUN="${DRY_RUN:-0}"
REQUIRED_MODEL="${READY_MODEL:-qwen3:8b}"
# Dev invocation (zero-dep, no build step needed). Override with OLLAMAS_BIN.
OLLAMAS="${OLLAMAS_BIN:-npx tsx $REPO/cli/index.ts}"

log()  { printf '\033[36m[fleet]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[fleet] uyarı:\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[fleet] HATA:\033[0m %s\n' "$*" >&2; exit 1; }

# 1) Prerequisites — reuse the existing idempotent readiness gate.
log "readiness gate (npm run ready)…"
if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY] npm run ready"
else
  npm run ready || warn "ready reported blocking items — continuing to fleet wiring"
fi

# 2) Tailscale must be up so peers are reachable by stable hostname.
if ! command -v tailscale >/dev/null 2>&1; then
  die "tailscale not found — install (brew install --cask tailscale) then 'tailscale up'. See cli/FLEET.md."
fi
if ! tailscale status >/dev/null 2>&1; then
  die "tailscale is installed but not connected — run 'tailscale up' (same account as the Windows workers), then re-run."
fi
log "tailscale connected: $(tailscale status --json 2>/dev/null | grep -o '"DNSName"[^,]*' | head -1 || echo ok)"

# 3) Auto-discover backends on the tailnet (no hand-typed IPs).
log "discovering ollama backends on the tailnet…"
if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY] $OLLAMAS remote discover"
else
  $OLLAMAS remote discover || warn "discover found no extra workers yet (start fleet-join.ps1 on each Windows)"
fi

# 4) Supervisor — point the gateway at the best backend, fail over on loss.
log "starting failover supervisor (priority-ordered; Ctrl-C to stop)…"
if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY] $OLLAMAS remote up --watch --required $REQUIRED_MODEL"
  exit 0
fi
exec $OLLAMAS remote up --watch --required "$REQUIRED_MODEL"
