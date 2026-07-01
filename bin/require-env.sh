#!/usr/bin/env bash
# require-env.sh — sourceable env-guard for the boot scripts (shell-harden stream).
# Fail fast with a clear message when a required environment variable is unset/empty, instead of a
# script dying deep with an obscure error. Sourced by start.sh; unit-tested in isolation
# (scripts/tests/require-env.test.ts) so it needs no full boot.
#
#   source bin/require-env.sh
#   require_env PORT DATABASE_URL   # exits 78 (EX_CONFIG) listing every missing var
#
# Non-destructive: only reads env + prints to stderr. Vars with a `${VAR:-default}` fallback are always
# set by the time they are checked, so guarding them is a safe no-op; genuinely-required vars fail fast.
require_env() {
  local missing=0 v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      echo "FATAL: required environment variable '$v' is unset" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || return 78  # EX_CONFIG; caller (set -e) turns a non-zero return into an exit
}
