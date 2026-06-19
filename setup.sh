#!/bin/bash
# Genesis Cluster Mesh E2E Setup Script for macOS M4 Pro Max
# DRY_RUN=1 → no side effects; mutating ops printed as [DRY] (rehearsal/test).
set -euo pipefail
DRY_RUN="${DRY_RUN:-0}"

# BSD-safe script dir (no readlink -f; pure-bash-bible MIT pattern) — work from
# the script's own location, not the caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Gate a side-effecting command behind DRY_RUN (echo instead of execute).
run() {
  if [ "$DRY_RUN" = "1" ]; then printf '\033[35m[DRY]\033[0m would run: %s\n' "$*"; else "$@"; fi
}

echo "[MASTER] Starting Cluster Mesh Initialization..."

# 1. Directory Structure
run mkdir -p bin

# 2. Compile Orchestrator
echo "[MASTER] Building Binary..."
if [ -f "bin/main.go" ]; then
  run sh -c 'cd bin && go build -o hardware_orchestrator main.go'
else
  echo "[WARNING] bin/main.go not found, skipping binary build."
  echo "Please ensure binary is present in bin/."
fi

# 3. Environment Check
echo "[MASTER] Verifying Python/Node Environment..."
run node -v
run go version

echo "[MASTER] Initialization Complete."
echo "Execute 'npm run dev' to start the orchestrator server."
