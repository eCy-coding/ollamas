#!/usr/bin/env bash
# verify.sh — prove the always-running launchd agent actually self-heals.
#
# Verifies the RunAtLoad + KeepAlive contract of com.ollamas.server end-to-end:
#   plist loaded?  ->  find PID  ->  kill it  ->  wait <=30s for launchd to respawn
#   ->  /api/health returns 200  ->  "RESPAWN OK" (exit 0)  |  otherwise exit 1.
#
# This is a POST-INSTALL check: it does NOT load/install the agent (an agent cannot
# load launchd; the operator runs ops/launchd/install-server.sh first). It only
# exercises an already-loaded agent. Safe to re-run.
#
# Usage:
#   ops/launchd/verify.sh                       # defaults: com.ollamas.server on :3000
#   LABEL=com.ollamas.server PORT=3000 ops/launchd/verify.sh
#   HEALTH_URL=http://127.0.0.1:3000/api/health ops/launchd/verify.sh
#
# Env overrides:
#   LABEL       launchd job label            (default: com.ollamas.server)
#   PORT        server port for health probe (default: 3000)
#   HEALTH_URL  full health URL              (default: http://127.0.0.1:$PORT/api/health)
#   TIMEOUT     max seconds to await respawn (default: 30)
set -u

LABEL="${LABEL:-com.ollamas.server}"
PORT="${PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"
TIMEOUT="${TIMEOUT:-30}"

GUI="gui/$(id -u)"

log()  { printf '[verify] %s\n' "$*" >&2; }
fail() { printf 'RESPAWN FAIL: %s\n' "$*" >&2; exit 1; }

# --- 1. plist loaded? -------------------------------------------------------
# `launchctl list <label>` exits non-zero when the job is not loaded.
if ! launchctl list "$LABEL" >/dev/null 2>&1; then
  fail "launchd job '$LABEL' is not loaded. Run ops/launchd/install-server.sh first."
fi
log "job '$LABEL' is loaded."

# --- 2. find the current PID ------------------------------------------------
# `launchctl list <label>` prints a plist-ish block containing `"PID" = NNN;`.
# A dash / missing PID means the job is loaded but not currently running.
pid_of() {
  launchctl list "$LABEL" 2>/dev/null \
    | sed -n 's/.*"PID" = \([0-9][0-9]*\);.*/\1/p' \
    | head -n1
}

OLD_PID="$(pid_of)"
if [ -z "${OLD_PID:-}" ]; then
  # Not running yet — kickstart it so we have a live PID to kill.
  log "no live PID; kickstarting '$LABEL' before the respawn test."
  launchctl kickstart -k "${GUI}/${LABEL}" >/dev/null 2>&1 || true
  for _ in $(seq 1 10); do
    OLD_PID="$(pid_of)"
    [ -n "${OLD_PID:-}" ] && break
    sleep 1
  done
fi
[ -n "${OLD_PID:-}" ] || fail "could not obtain a running PID for '$LABEL'."
log "current PID = $OLD_PID."

# --- 3. kill it (simulate a crash) ------------------------------------------
log "killing PID $OLD_PID to trigger KeepAlive respawn..."
kill -9 "$OLD_PID" 2>/dev/null || true

# --- 4. wait <=TIMEOUT for a NEW pid + healthy endpoint ---------------------
DEADLINE=$(( $(date +%s) + TIMEOUT ))
NEW_PID=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  NEW_PID="$(pid_of)"
  if [ -n "${NEW_PID:-}" ] && [ "$NEW_PID" != "$OLD_PID" ]; then
    # New process exists — now confirm it actually serves traffic.
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" 2>/dev/null || echo 000)"
    if [ "$CODE" = "200" ]; then
      log "respawned PID $NEW_PID; $HEALTH_URL -> $CODE."
      echo "RESPAWN OK (label=$LABEL old_pid=$OLD_PID new_pid=$NEW_PID health=$CODE)"
      exit 0
    fi
    log "PID $NEW_PID up but health=$CODE, retrying..."
  fi
  sleep 1
done

fail "no healthy respawn within ${TIMEOUT}s (last_pid=${NEW_PID:-none}, health_url=$HEALTH_URL)."
