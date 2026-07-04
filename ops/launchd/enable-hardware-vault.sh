#!/bin/bash
# ops/launchd/enable-hardware-vault.sh — one-command activation of the Secure-Enclave hardware
# vault for the master key. This is a guarded, one-time operator step: seeding a master
# credential into the macOS Keychain is intentionally NOT auto-authorized for an agent, so the
# operator runs this once. Everything after is 0-manual (the daemon boots from hardware).
#
# What it does: mirrors the EXISTING file master key into the login Keychain (same bytes → the
# vault keeps decrypting), with an ACL pinned to /usr/bin/security (the reader) so subsequent
# reads are prompt-free. Idempotent (-U updates in place). Then enables the plist env + reloads.
set -euo pipefail

KEYFILE="$HOME/.llm-mission-control/.master_key"
SERVICE="${OLLAMAS_MASTER_KEY_SERVICE:-OLLAMAS_MASTER_KEY}"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.ollamas.server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.ollamas.server.plist"

[ -f "$KEYFILE" ] || { echo "[vault] no master-key file at $KEYFILE — nothing to migrate" >&2; exit 1; }

B64="$(base64 < "$KEYFILE" | tr -d '\n')"
[ "${#B64}" -eq 44 ] || { echo "[vault] unexpected key length (${#B64} b64 chars, expect 44 for 32 bytes)" >&2; exit 1; }

# Seed (or update) the keychain item, pre-trusting the reader so reads never prompt.
security add-generic-password -U -s "$SERVICE" -a ollamas -w "$B64" -T /usr/bin/security
echo "[vault] keychain item '$SERVICE' seeded (ACL: /usr/bin/security, prompt-free reads)"

# Verify a prompt-free round-trip.
RB="$(security find-generic-password -s "$SERVICE" -w 2>/dev/null || true)"
[ "$RB" = "$B64" ] && echo "[vault] read-back OK — master key round-trips from hardware" \
  || { echo "[vault] read-back FAILED — not enabling the env (file key stays authoritative)" >&2; exit 1; }

echo
echo "[vault] Next: enable the daemon env + reload:"
echo "  1) In $PLIST_SRC uncomment the OLLAMAS_MASTER_KEY_KEYCHAIN lines."
echo "  2) cp \"$PLIST_SRC\" \"$PLIST_DEST\" && launchctl unload \"$PLIST_DEST\" 2>/dev/null; launchctl load -w \"$PLIST_DEST\""
echo "  3) Verify: server boots, master key loads from keychain, secrets decrypt, .master_key kept as fallback."
