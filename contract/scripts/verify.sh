#!/usr/bin/env bash
# Contract lane self-gate (vK16). Proves the contract slice is green INDEPENDENT of
# the root repo — the contract lane is isolated (root tsc/vitest never compile it),
# so a parallel worker's WIP that reddens the whole-repo pre-commit gate must not
# hold contract commits hostage. Convention (CONTRACT_AGENTS.md §): a contract-only
# commit is `bash contract/scripts/verify.sh && GATE_SKIP=1 git commit …` — the
# GATE_SKIP is legitimate ONLY after this passes (never a blind skip; ERR-CONTRACT-009).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "▶ contract self-gate: typecheck → node --test"
npm run -s typecheck
npm test
echo "✓ contract slice green"
