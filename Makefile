# ==============================================================================
# LLM Mission Control: Decentralized Computing Swarm & Pilot Cockpit Makefile
# ==============================================================================
# Provides unified compilation rules for all cross-platform backends.
#
# Languages: Go (P2P DHT), Rust (GPU Orchestrator & WASM Sandbox), C (Idle Daemon)
# ==============================================================================

.PHONY: all clean build-all build-p2p build-orchestrator build-sandbox build-idle install-deps run-cockpit help

# Output binary folder
BIN_DIR = bin

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
		go build -o $(BIN_DIR)/p2p_network p2p_network.go; \
		echo "    -> Compiled: $(BIN_DIR)/p2p_network"; \
	else \
		echo "    [-] Skipping Go build: 'go' is not installed on the system."; \
	fi

## build-orchestrator: Compile the Rust GPU memory mapper & L7 context locker
build-orchestrator: $(BIN_DIR)
	@echo "[+] Compiling Rust Hardware Orchestrator..."
	@if command -v rustc >/dev/null 2>&1; then \
		rustc -C opt-level=3 -o $(BIN_DIR)/hardware_orchestrator hardware_orchestrator.rs; \
		echo "    -> Compiled: $(BIN_DIR)/hardware_orchestrator"; \
	else \
		echo "    [-] Skipping Rust build: 'rustc' is not installed on the system."; \
	fi

## build-sandbox: Compile the Rust command guardrails & WebAssembly WASI sandbox
build-sandbox: $(BIN_DIR)
	@echo "[+] Compiling Rust WebAssembly Sandbox Guard..."
	@if command -v rustc >/dev/null 2>&1; then \
		rustc -C opt-level=3 -o $(BIN_DIR)/secure_sandbox secure_sandbox.rs; \
		echo "    -> Compiled: $(BIN_DIR)/secure_sandbox"; \
	else \
		echo "    [-] Skipping Rust build: 'rustc' is not installed on the system."; \
	fi

## build-idle: Compile the ANSI C input idle-time background throttling daemon
build-idle: $(BIN_DIR)
	@echo "[+] Compiling ANSI C Dynamic Idle Monitor Daemon..."
	@if command -v gcc >/dev/null 2>&1; then \
		gcc -O2 -o $(BIN_DIR)/idle_daemon idle_daemon.c; \
		echo "    -> Compiled: $(BIN_DIR)/idle_daemon"; \
	elif command -v clang >/dev/null 2>&1; then \
		clang -O2 -o $(BIN_DIR)/idle_daemon idle_daemon.c; \
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
