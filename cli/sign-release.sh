#!/usr/bin/env bash
# Detached-sign built release artifacts with minisign (v18 Phase 3, release-signing).
#
# Given the built artifact(s) in dist/ (the SEA binary + any tarball/checksum), this
# produces a `<artifact>.minisig` next to each, and prints the keyId so the release
# workflow can embed { minisig, keyId } into latest.json (cli/lib/manifest.ts Asset).
# The CLI then verifies that detached sig against the pinned pubkey on `ollamas update`
# (cli/lib/minisign-verify.ts; PINNED_PUBKEYS in cli/lib/pubkey.ts).
#
# USAGE:
#   MINISIGN_SECKEY=~/.minisign/ollamas.key cli/sign-release.sh [artifact ...]
#   cli/sign-release.sh                       # defaults to dist/ollamas-<os>-<arch>
#
# The secret-key path comes from $MINISIGN_SECKEY (default ~/.minisign/ollamas.key).
# An unencrypted key (minisign -W) is required for non-interactive CI; for local
# operator use an encrypted key prompts for its password. Fails LOUDLY if the key is
# absent — it will NOT silently ship unsigned artifacts. Idempotent: re-running
# overwrites the .minisig (minisign -S already truncates), so it's safe to retry.
#
# OPERATOR KEYGEN (one-time, do this OUTSIDE CI; never commit the .key):
#   minisign -G -s ~/.minisign/ollamas.key -p ~/.minisign/ollamas.pub
#   # then paste the .pub's two lines into cli/lib/pubkey.ts PINNED_PUBKEYS, e.g.:
#   #   "untrusted comment: minisign public key ABCD...\nRWS...<base64>",
#   # For CI, generate an UNENCRYPTED key with -W and store it as the
#   # MINISIGN_SECKEY GitHub Actions secret (the whole key file's contents).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECKEY="${MINISIGN_SECKEY:-$HOME/.minisign/ollamas.key}"

command -v minisign >/dev/null 2>&1 || { echo "minisign not found on PATH (need >= 0.11)" >&2; exit 1; }

# Fail loudly if no key — never sign with nothing.
[ -f "$SECKEY" ] || { echo "minisign secret key not found at: $SECKEY (set \$MINISIGN_SECKEY)" >&2; exit 1; }

# Default artifact set = the SEA binary for this host (matches build-sea.sh naming).
if [ "$#" -eq 0 ]; then
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) ARCH=arm64 ;; esac
  set -- "dist/ollamas-${OS}-${ARCH}"
fi

# keyId: minisign renders it (little-endian of pubkey bytes 2..10) in the .pub's
# untrusted-comment line. If a sibling .pub exists we read it from there (exactly the
# string minisign/cli display); otherwise derive it from the secret-key file's comment.
# This avoids re-implementing the byte-order in shell.
derive_key_id() {
  local pub="${SECKEY%.key}.pub"
  local id=""
  if [ -f "$pub" ]; then
    id="$(grep -oE '[0-9A-Fa-f]{16}' "$pub" | head -1 || true)"
  fi
  if [ -z "$id" ]; then
    # secret-key file line 1 is also an "untrusted comment" carrying the keyId.
    id="$(grep -oE '[0-9A-Fa-f]{16}' "$SECKEY" | head -1 || true)"
  fi
  printf '%s' "${id^^}"   # uppercase, may be empty if not derivable
}

KEY_ID="$(derive_key_id)"

signed=0
for art in "$@"; do
  [ -f "$art" ] || { echo "artifact not found, skipping: $art" >&2; continue; }
  echo "signing $art" >&2
  # -S detached sign; key password (if encrypted) comes from MINISIGN_PASSWORD or prompt.
  if [ -n "${MINISIGN_PASSWORD:-}" ]; then
    printf '%s\n' "$MINISIGN_PASSWORD" | minisign -S -s "$SECKEY" -m "$art" >/dev/null
  else
    minisign -S -s "$SECKEY" -m "$art" >/dev/null
  fi
  [ -f "${art}.minisig" ] || { echo "expected ${art}.minisig was not produced" >&2; exit 1; }
  signed=$((signed + 1))
done

[ "$signed" -gt 0 ] || { echo "no artifacts signed" >&2; exit 1; }

# Emit machine-readable outputs for the workflow.
echo "OLLAMAS_KEY_ID=${KEY_ID}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "key_id=${KEY_ID}" >> "$GITHUB_OUTPUT"
fi
echo "signed ${signed} artifact(s); keyId=${KEY_ID:-<unknown>}" >&2
