// One-click device installer renderer (vK19). Produces a self-contained bash script
// the operator serves at GET /api/contract/install.sh?t=<token>. A fresh device runs
// it (one paste) and ends up meshed + contributing:
//   ensure node≥24 + cmake → mesh-join (authkey) → fetch signed CLI bundle →
//   VERIFY the operator signature (RISK-K21) → run `bootstrap <token>`.
// PURE string builder — no IO. The device's bootstrap does the rest (build + auto-
// approve + offer), all existing code.

export type InstallerParams = {
  operatorMeshUrl: string; // e.g. http://100.64.0.1:3000 (reachable after mesh-join)
  token: string; // the enriched invite token
  headscaleUrl: string; // mesh coordination server; "" → skip auto mesh-join
  authkey: string; // fresh preauth key; "" → skip auto mesh-join (already on mesh / manual)
  opPubHex: string; // operator pubkey → verify the CLI bundle before exec
};

const sh = (s: string) => s.replace(/[`$\\"]/g, (m) => "\\" + m); // conservative shell escaping for interpolation

export function renderInstaller(p: InstallerParams): string {
  const meshJoin = p.headscaleUrl && p.authkey
    ? `if ! tailscale ip -4 >/dev/null 2>&1; then
  echo "[install] joining mesh…"
  tailscale up --login-server "${sh(p.headscaleUrl)}" --authkey "${sh(p.authkey)}" --accept-routes
fi`
    : `echo "[install] no authkey in invite — assuming this machine is already on the mesh"`;

  return `#!/usr/bin/env bash
# ollamas contract — one-click device installer (vK19). Fetched over the encrypted
# mesh from the operator's private IP; verifies the operator's signature on the CLI
# bundle before running it. Safe under sovereign single-owner; see RISK-K21 for
# multi-party trust.
set -euo pipefail

OP_URL="${sh(p.operatorMeshUrl)}"
TOKEN="${sh(p.token)}"
OP_PUB="${p.opPubHex}"
DIR="$HOME/.ollamas"
mkdir -p "$DIR"

# 1) node >= 24
if ! command -v node >/dev/null 2>&1; then
  echo "[install] node not found — installing via Homebrew…"
  command -v brew >/dev/null 2>&1 || { echo "install Homebrew first: https://brew.sh"; exit 1; }
  brew install node
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || { echo "node >= 24 required (have $NODE_MAJOR)"; exit 1; }

# 2) cmake (for the RPC llama.cpp build the bootstrap runs)
if ! command -v cmake >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 && brew install cmake || { echo "cmake required (brew install cmake)"; exit 1; }
fi

# 3) mesh-join (only when the invite carried a fresh authkey)
${meshJoin}

# 4) fetch the signed contract CLI bundle from the operator (over the mesh)
curl -fsSL "$OP_URL/api/contract/cli" -o "$DIR/contract-cli.mjs"
curl -fsSL "$OP_URL/api/contract/cli.sig" -o "$DIR/contract-cli.sig"

# 5) VERIFY the operator's signature over the bundle BEFORE running it (RISK-K21).
#    Uses only node:crypto — the same ed25519 the lane signs with.
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
const dir = process.env.HOME + "/.ollamas";
const bytes = readFileSync(dir + "/contract-cli.mjs");
const sigHex = readFileSync(dir + "/contract-cli.sig", "utf8").trim();
const sha = createHash("sha256").update(bytes).digest("hex");
const pubHex = process.argv[1];
let ok = false;
try {
  const key = createPublicKey({ key: Buffer.from(pubHex, "hex"), format: "der", type: "spki" });
  ok = verify(null, Buffer.from(sha, "utf8"), key, Buffer.from(sigHex, "hex"));
} catch { ok = false; }
if (!ok) { console.error("[install] SIGNATURE VERIFY FAILED — refusing to run unverified CLI"); process.exit(1); }
console.error("[install] bundle signature OK");
' "$OP_PUB"

# 6) run the turnkey bootstrap (build + auto-approve + offer)
exec node "$DIR/contract-cli.mjs" bootstrap "$TOKEN"
`;
}
