#!/usr/bin/env bash
# Install the brain git-capture hooks for THIS worktree only (worktree-local
# core.hooksPath — other lanes/worktrees keep the plain shared gate).
# Usage: bash scripts/install-brain-hooks.sh   (idempotent)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

git config extensions.worktreeConfig true
chmod +x scripts/git-hooks/pre-commit scripts/git-hooks/pre-merge-commit scripts/git-hooks/pre-push
git config --worktree core.hooksPath scripts/git-hooks

echo "✓ brain hooks active for $(basename "$PWD") (pre-commit / pre-merge-commit / pre-push)"
echo "  capture: npx tsx scripts/brain-git-capture.ts | disable per-shell: BRAIN_GIT_CAPTURE=0"
echo "  uninstall: git config --worktree --unset core.hooksPath"
