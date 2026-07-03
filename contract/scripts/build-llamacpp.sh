#!/usr/bin/env bash
# Build llama.cpp WITH the RPC backend (brew bottle ships without GGML_RPC).
# Installs rpc-server + llama-server into ~/.ollamas/bin (outside the repo).
# MIT binary-adopt per CONTRACT_ADOPTION.md. Idempotent: skips if both binaries
# already exist and support RPC (use --force to rebuild).
set -euo pipefail

BIN_DIR="${OLLAMAS_LLAMA_BIN_DIR:-$HOME/.ollamas/bin}"
SRC_DIR="${LLAMACPP_SRC_DIR:-$HOME/.ollamas/src/llama.cpp}"
FORCE="${1:-}"

if [ "$FORCE" != "--force" ] && [ -x "$BIN_DIR/rpc-server" ] && [ -x "$BIN_DIR/llama-server" ]; then
  if "$BIN_DIR/llama-server" --help 2>&1 | grep -q -- "--rpc"; then
    echo "OK: RPC-enabled binaries already in $BIN_DIR (use --force to rebuild)"
    exit 0
  fi
fi

command -v cmake >/dev/null || { echo "cmake required (brew install cmake)"; exit 1; }
command -v git >/dev/null || { echo "git required"; exit 1; }

mkdir -p "$BIN_DIR" "$(dirname "$SRC_DIR")"
if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$SRC_DIR"
fi

cd "$SRC_DIR"
cmake -B build -DGGML_RPC=ON -DGGML_METAL=ON -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF
cmake --build build --config Release -j "$(sysctl -n hw.ncpu)" -t ggml-rpc-server llama-server

# target ggml-rpc-server emits build/bin/rpc-server (historic name kept by upstream)
RPC_BIN="build/bin/rpc-server"; [ -x "$RPC_BIN" ] || RPC_BIN="build/bin/ggml-rpc-server"
cp "$RPC_BIN" "$BIN_DIR/rpc-server"
cp build/bin/llama-server "$BIN_DIR/"
echo "installed: $BIN_DIR/rpc-server + $BIN_DIR/llama-server"
# grep -q would SIGPIPE llama-server (exit 141 in pipefail) — count instead.
RPC_COUNT="$("$BIN_DIR/llama-server" --help 2>&1 | grep -c -- "--rpc" || true)"
[ "$RPC_COUNT" -ge 1 ] && echo "verified: --rpc flag present"
