#!/usr/bin/env bash
# Brain 0-manual bootstrap — install everything the brain needs to sustain itself:
#   1) git-capture hooks (memory before every commit/merge/push)
#   2) autonomous maintenance launchd agent (daily 04:00 sweep + consolidate + drift)
# Idempotent: safe to re-run. Non-destructive (maintenance only decays working-tier;
# core/learned/procedural are never evicted). Undo instructions printed at the end.
# Usage: bash scripts/brain-bootstrap.sh   (or: make brain-bootstrap)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="com.ollamas.brain-maintain.plist"

echo "▶ brain bootstrap ($(basename "$ROOT"))"

# 1) git-capture hooks (worktree-local; other lanes untouched)
bash scripts/install-brain-hooks.sh

# 2) autonomous maintenance agent
mkdir -p "$AGENTS"
cp "scripts/$PLIST" "$AGENTS/$PLIST"
# Reload cleanly if already present.
launchctl unload "$AGENTS/$PLIST" 2>/dev/null || true
launchctl load "$AGENTS/$PLIST"

if launchctl list | grep -q "com.ollamas.brain-maintain"; then
  echo "✓ brain-maintain agent loaded (daily 04:00; log /tmp/ollamas-brain-maintain.log)"
else
  echo "✗ brain-maintain agent NOT listed — check $AGENTS/$PLIST" >&2
  exit 1
fi

echo ""
echo "✓ brain is self-sustaining (0-manual):"
echo "  • every commit/merge/push captures memory (fast-fail ${BRAIN_CAPTURE_TIMEOUT_MS:-3000}ms)"
echo "  • daily 04:00 autonomous maintenance (sweep + consolidate + drift check)"
echo "  peek:   make brain-show          | trigger now: launchctl kickstart -k gui/$(id -u)/com.ollamas.brain-maintain"
echo "  undo:   launchctl unload $AGENTS/$PLIST && git config --worktree --unset core.hooksPath"
echo "  NOTE: plist points at this worktree — after merge, repoint paths to \$HOME/Desktop/ollamas."
