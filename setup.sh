#!/bin/bash
# Genesis Cluster Mesh E2E Setup Script for macOS M4 Pro Max
set -e

echo "[MASTER] Starting Cluster Mesh Initialization..."

# 1. Directory Structure
mkdir -p bin

# 2. Compile Orchestrator
echo "[MASTER] Building Binary..."
if [ -f "bin/main.go" ]; then
    cd bin && go build -o hardware_orchestrator main.go && cd ..
else
    echo "[WARNING] bin/main.go not found, skipping binary build."
    echo "Please ensure binary is present in bin/."
fi

# 3. Environment Check
echo "[MASTER] Verifying Python/Node Environment..."
node -v
go version

echo "[MASTER] Initialization Complete."
echo "Execute 'npm run dev' to start the orchestrator server."
