#!/bin/bash
# ollamas setup — thin wrapper over the canonical instant-on path (`npm run ready`).
# Kept for muscle-memory / older docs; the real front door is `npm run ready` (see QUICKSTART.md).
# DRY_RUN=1 → no side effects; the underlying step is printed instead of run.
set -euo pipefail
DRY_RUN="${DRY_RUN:-0}"

# BSD-safe script dir (no readlink -f) — work from the repo root, not the caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[setup] ollamas → delegating to 'npm run ready' (idempotent prerequisite detect + auto-fix)."

if [ "$DRY_RUN" = "1" ]; then
  printf '\033[35m[DRY]\033[0m would run: npm run ready\n'
else
  npm run ready
fi

echo "[setup] Done. Start serving with: npm run dev   (or: make up)"
echo "[setup] Full guide: QUICKSTART.md"
