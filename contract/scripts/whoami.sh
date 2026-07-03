#!/usr/bin/env bash
# Read-only self-state collector for the contract lane (tunnel whoami pattern).
set -uo pipefail
LANE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LANE_DIR" || exit 1

echo "=== CONTRACT LANE SELF-REPORT (live) ==="
echo "ts: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "dir: $LANE_DIR"
echo "version: $(cat VERSION 2>/dev/null || echo '?')"
echo

BRANCH="$(git branch --show-current 2>/dev/null || echo '?')"
echo "branch: $BRANCH"
echo "recent commits (contract/):"
git log --oneline -3 -- . 2>/dev/null | sed 's/^/  /'
echo

echo "shipped (ROADMAP.md ✅ DONE):"
grep -E '✅ DONE' ROADMAP.md 2>/dev/null | sed -E 's/^\| \*\*(vK[0-9]+)\*\* \| ([^|]+).*/  \1 — \2/' | sed 's/\*\*//g; s/[[:space:]]*$//'
NEXT_VER="$(grep -E '^## vK[0-9]+ .*NEXT' ROADMAP.md 2>/dev/null | grep -oE 'vK[0-9]+' | head -1)"
echo "next: ${NEXT_VER:-?}"
echo

echo "tests:"
node --test 2>/dev/null | grep -E '^ℹ (tests|pass|fail)' | sed 's/^/  /'
echo
echo "errors registry:"
node -e "const r=require('./errors_registry.json');for(const e of r.errors)console.log('  '+e.id+' — '+e.title)" 2>/dev/null
