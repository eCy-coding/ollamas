#!/usr/bin/env bash
# Bundle the contract CLI into ONE self-contained file (vK19) + sign it with the
# operator key, so a fresh device can fetch + verify + run it with only a node
# runtime (contract/src is zero-dep → esbuild inlines everything). Served by the
# operator at GET /api/contract/cli (+ .sig). Re-run after any CLI change.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root
OUT="$ROOT/dist/contract-cli.mjs"
SIG="$ROOT/dist/contract-cli.sig"
mkdir -p "$ROOT/dist"

ESBUILD="$ROOT/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "esbuild not found ($ESBUILD) — run npm install at repo root"; exit 1; }

"$ESBUILD" "$ROOT/contract/src/cli.ts" \
  --bundle --platform=node --format=esm --target=node24 \
  --outfile="$OUT"
echo "bundled → $OUT ($(wc -c < "$OUT") bytes)"

# Sign sha256(bundle) with the operator key (creates it on first use, 0600).
node --input-type=module -e '
import { loadOrCreateOperatorKey } from "'"$ROOT"'/contract/src/opkey.ts";
import { bundleSha256, signBundle } from "'"$ROOT"'/contract/src/bundle.ts";
import { readFileSync, writeFileSync } from "node:fs";
const op = loadOrCreateOperatorKey();
const sha = bundleSha256(readFileSync(process.argv[1]));
writeFileSync(process.argv[2], signBundle(sha, op.privateKeyPem) + "\n", { mode: 0o644 });
console.error("signed with operator epoch " + op.epoch + " → " + process.argv[2]);
' "$OUT" "$SIG"
echo "OK — serve via GET /api/contract/cli (+ .sig)"
