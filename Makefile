# ==============================================================================
# LLM Mission Control: Decentralized Computing Swarm & Pilot Cockpit Makefile
# ==============================================================================
# Provides unified compilation rules for all cross-platform backends.
#
# Languages: Go (P2P DHT), Rust (GPU Orchestrator & WASM Sandbox), C (Idle Daemon)
# ==============================================================================

.PHONY: all clean build-all build-p2p build-orchestrator build-sandbox build-idle install-deps run-cockpit help up down lint-sh fmt-sh fmt-sh-check test-sh harden gate ship commit watch scaffold e2e

# Output binary folder
BIN_DIR = bin

# In-scope shell scripts (scripts lane, v6 hardening)
SH_FILES = start.sh stop.sh install.sh setup.sh setup-keys.sh join-cluster.sh uninstall.sh bin/host-bridge/start-bridge.sh

all: help

# Create bin target folder
$(BIN_DIR):
	mkdir -p $(BIN_DIR)

## build-all: Compile all heterogeneous P2P computing daemon nodes (Go + Rust + C)
build-all: $(BIN_DIR) build-p2p build-orchestrator build-sandbox build-idle
	@echo "======================================================================"
	@echo "[+] SUCCESS: All multi-language P2P computing modules compiled successfully!"
	@echo "    Compiled binaries residing inside: ./$(BIN_DIR)/"
	@echo "======================================================================"

## build-p2p: Compile the Go libp2p Kademlia DHT discovery engine
build-p2p: $(BIN_DIR)
	@echo "[+] Compiling Go P2P Network Daemon..."
	@if command -v go >/dev/null 2>&1; then \
		go build -o $(BIN_DIR)/p2p_network backend/mesh/p2p_network.go; \
		echo "    -> Compiled: $(BIN_DIR)/p2p_network"; \
	else \
		echo "    [-] Skipping Go build: 'go' is not installed on the system."; \
	fi

## build-orchestrator: Compile the Rust GPU memory mapper & L7 context locker
build-orchestrator: $(BIN_DIR)
	@echo "[+] Compiling Rust Hardware Orchestrator..."
	@if command -v rustc >/dev/null 2>&1; then \
		rustc -C opt-level=3 -o $(BIN_DIR)/hardware_orchestrator backend/orchestrator/hardware_orchestrator.rs; \
		echo "    -> Compiled: $(BIN_DIR)/hardware_orchestrator"; \
	else \
		echo "    [-] Skipping Rust build: 'rustc' is not installed on the system."; \
	fi

## build-sandbox: Compile the Rust command guardrails & WebAssembly WASI sandbox
build-sandbox: $(BIN_DIR)
	@echo "[+] Compiling Rust WebAssembly Sandbox Guard..."
	@if command -v rustc >/dev/null 2>&1; then \
		rustc -C opt-level=3 -o $(BIN_DIR)/secure_sandbox backend/sandbox/secure_sandbox.rs; \
		echo "    -> Compiled: $(BIN_DIR)/secure_sandbox"; \
	else \
		echo "    [-] Skipping Rust build: 'rustc' is not installed on the system."; \
	fi

## build-idle: Compile the ANSI C input idle-time background throttling daemon
build-idle: $(BIN_DIR)
	@echo "[+] Compiling ANSI C Dynamic Idle Monitor Daemon..."
	@if command -v gcc >/dev/null 2>&1; then \
		gcc -O2 -o $(BIN_DIR)/idle_daemon backend/daemon/idle_daemon.c; \
		echo "    -> Compiled: $(BIN_DIR)/idle_daemon"; \
	elif command -v clang >/dev/null 2>&1; then \
		clang -O2 -o $(BIN_DIR)/idle_daemon backend/daemon/idle_daemon.c; \
		echo "    -> Compiled: $(BIN_DIR)/idle_daemon"; \
	else \
		echo "    [-] Skipping C build: 'gcc' or 'clang' is not installed on the system."; \
	fi

## install-deps: Install local Node.js packages for the React web cockpit
install-deps:
	@echo "[+] Installing Node.js packages..."
	npm install

## run-cockpit: Boot the unified pilot platform and express backend
run-cockpit:
	@echo "[+] Launching LLM Mission Control..."
	npm run dev

## up: One command — bring the whole stack up end-to-end (bridge + container + health)
up:
	@./start.sh

## down: Stop the stack (container + host bridge)
down:
	@./stop.sh

## lint-sh: shellcheck all in-scope .sh (skip+warn if shellcheck absent)
lint-sh:
	@if command -v shellcheck >/dev/null 2>&1; then \
		echo "[+] shellcheck (severity=warning)..."; \
		shellcheck --severity=warning $(SH_FILES) && echo "    -> clean"; \
	else \
		echo "    [!] SKIP: shellcheck not installed (brew install shellcheck)"; \
	fi

## fmt-sh: shfmt -w all in-scope .sh (2-space, skip+warn if shfmt absent)
fmt-sh:
	@if command -v shfmt >/dev/null 2>&1; then \
		shfmt -i 2 -ci -w $(SH_FILES) && echo "[+] shfmt: formatted"; \
	else \
		echo "    [!] SKIP: shfmt not installed (brew install shfmt)"; \
	fi

## fmt-sh-check: shfmt diff gate — fail if any .sh is unformatted
fmt-sh-check:
	@if command -v shfmt >/dev/null 2>&1; then \
		shfmt -i 2 -ci -d $(SH_FILES) && echo "[+] shfmt: clean"; \
	else \
		echo "    [!] SKIP: shfmt not installed (brew install shfmt)"; \
	fi

## test-sh: run bats shell behavior tests (skip+warn if bats absent)
test-sh:
	@if command -v bats >/dev/null 2>&1; then \
		bats scripts/tests/sh/; \
	else \
		echo "    [!] SKIP: bats not installed (brew install bats-core)"; \
	fi

## harden: full shell hardening gate (lint + format-check + bats)
harden: lint-sh fmt-sh-check test-sh
	@echo "[+] shell hardening gate complete."

## gate: ONE-command scripts quality gate (tsc + vitest + harden + drift + swift). Zero-manual.
gate:
	@node bin/host-bridge/gate.mjs

## ship: run the full gate, then print the conventional-commit reminder (push stays manual)
ship: gate
	@echo "[+] gate green — stage per file and commit: feat|fix|refactor|chore|docs|test(scripts): vN <delta>"

## commit: zero-manual — gate green → scope-guarded conventional auto-commit (no push/tag). Usage: make commit MSG="feat(scripts): ..."
commit:
	@node bin/host-bridge/gate.mjs --commit --message "$(MSG)"

## watch: autonomous dev-loop — re-run the gate on every scripts/+bin/ change (Ctrl-C to stop)
watch:
	@node bin/host-bridge/gate.mjs --watch

## scaffold: generate next-version TDD skeleton (test + lib stub). Usage: make scaffold F=<feature> [WRITE=1] [TOOL=1]
scaffold:
	@node bin/host-bridge/scaffold.mjs $(F) $(if $(TOOL),--tool,) $(if $(WRITE),--write,)

## e2e: real-bridge end-to-end (spawns terminal-bridge; headless /exec + v14 security + fail-closed)
e2e:
	@BRIDGE_E2E=1 npx vitest run scripts/tests/bridge-e2e.test.ts

## clean: Remove all compiled target files and caches
clean:
	@echo "[+] Cleaning build deliverables..."
	rm -rf $(BIN_DIR)
	rm -rf dist
	rm -rf node_modules
	@echo "[+] Done."

## help: Show this informative help message
help:
	@echo "======================================================================"
	@echo "     LLM Mission Control - P2P Swarm Unified Compilation Center"
	@echo "======================================================================"
	@echo "Available target commands:"
	@echo ""
	@fgrep -h "##" $(MAKEFILE_LIST) | fgrep -v fgrep | sed -e 's/\\$$//' | sed -e 's/##//'
	@echo "======================================================================"
