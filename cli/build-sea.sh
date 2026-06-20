#!/usr/bin/env bash
# Build a canonical Node SEA (Single Executable Application) of the ollamas CLI.
#
# Uses the official CLASSIC SEA flow (node --experimental-sea-config + postject), so
# it works on Node 20+ WITHOUT the newer --build-sea flag (host is 24.x). The bundle
# is the same esbuild dist/cli/index.cjs the npm-run path uses. postject is a
# build-time devDep; the runtime stays zero-dep. Bun --compile (cli/build-binary.sh)
# remains an alternate. Output lands in gitignored dist/, ad-hoc codesigned on macOS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"   # official Node sentinel (cli/lib/sea.ts SEA_FUSE)
POSTJECT="node_modules/.bin/postject"

[ -x "$POSTJECT" ] || { echo "postject not found — run 'npm i -D postject'" >&2; exit 1; }
node -e 'require("node:sea")' 2>/dev/null || { echo "this Node lacks node:sea (need >= 20)" >&2; exit 1; }

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) ARCH=arm64 ;; esac
OUT="dist/ollamas-${OS}-${ARCH}"

mkdir -p dist
echo "bundling cli → dist/cli/index.cjs"
npm run build:cli >/dev/null

echo "generating SEA blob (node $(node -v), classic --experimental-sea-config)"
node --experimental-sea-config sea-config.json

echo "copying node runtime → $OUT"
cp "$(command -v node)" "$OUT"

# macOS: a signed binary must have its signature stripped before postject can add the
# Mach-O segment, then be re-signed. Linux needs neither.
if [ "$OS" = "darwin" ]; then
  codesign --remove-signature "$OUT" 2>/dev/null || true
  "$POSTJECT" "$OUT" NODE_SEA_BLOB dist/sea-prep.blob \
    --sentinel-fuse "$FUSE" --macho-segment-name NODE_SEA
  codesign -s - --force "$OUT" >/dev/null 2>&1 && echo "ad-hoc signed $OUT" || echo "codesign skipped (non-fatal)" >&2
else
  "$POSTJECT" "$OUT" NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse "$FUSE"
fi

chmod +x "$OUT"
echo "built $OUT"
"$OUT" version
