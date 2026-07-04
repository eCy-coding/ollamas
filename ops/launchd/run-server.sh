#!/bin/bash
# ops/launchd/run-server.sh — the always-running :3000 server entry for launchd KeepAlive.
# launchd execs THIS (not npm directly) so it can track + restart the real server process.
# Prefers the built bundle; falls back to tsx (dev) if the repo is unbuilt. Never opens a
# browser or brings up side services (that is start.sh's interactive job) — this is headless.
set -euo pipefail

REPO="${OLLAMAS_REPO:-/Users/emrecnyngmail.com/Desktop/ollamas}"
cd "$REPO"

export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"
# Hardware vault (Secure Enclave-backed keychain) is opt-in; the daemon leaves it to the
# operator's environment. Set OLLAMAS_MASTER_KEY_KEYCHAIN=1 in the plist to enable.

# Prefer the built server bundle (fast boot, no transpile); fall back to tsx for an unbuilt repo.
if [ -f dist/server.cjs ]; then
  exec node dist/server.cjs
fi
exec npx tsx server.ts
