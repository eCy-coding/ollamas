#!/usr/bin/env bash
# Build a single-file native binary of the ollamas CLI via Bun --compile.
# The CLI is zero-dep (node:crypto/fs + fetch), so it compiles cleanly. Output
# lands in the gitignored dist/. macOS: ad-hoc code-signed so Gatekeeper does not
# hard-block a locally built binary. See cli/PACKAGING.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v bun >/dev/null 2>&1 || { echo "bun not found — install from https://bun.sh" >&2; exit 1; }
BUNV="$(bun --version)"
# Bun 1.3.12 shipped an arm64 "Killed: 9" regression; 1.3.13 fixes it.
case "$BUNV" in
  0.*|1.0.*|1.1.*|1.2.*|1.3.0|1.3.1|1.3.2|1.3.3|1.3.4|1.3.5|1.3.6|1.3.7|1.3.8|1.3.9|1.3.10|1.3.11|1.3.12)
    echo "warning: Bun $BUNV may hit the arm64 'Killed:9' regression — upgrade to >= 1.3.13" >&2 ;;
esac

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) ARCH=arm64 ;; esac
TARGET="bun-${OS}-${ARCH}"
OUT="dist/ollamas-${OS}-${ARCH}"

mkdir -p dist
echo "compiling cli/index.ts → $OUT ($TARGET, Bun $BUNV)"
bun build cli/index.ts --compile --target="$TARGET" --outfile "$OUT"

if [ "$OS" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
  codesign -s - --force "$OUT" >/dev/null 2>&1 && echo "ad-hoc signed $OUT" || echo "codesign skipped (non-fatal)" >&2
fi

echo "built $OUT"
"$OUT" version
