// Pinned minisign public keys for `ollamas update` signature verification (TOFU pin).
// Supports two keys to allow key rotation: add the new key FIRST, ship, then remove the old.
//
// WHY pinned here (not env/config): env vars can be overridden by attackers who control the
// process environment; a compile-time pin is the smallest attack surface for a self-update path.
//
// OPERATOR SETUP: run `minisign -G` → copy the one-line pubkey (untrusted comment + base64 line)
// and replace the PLACEHOLDER below. Leave the array EMPTY until you have a real key — empty
// array triggers bootstrap mode (sha256-only + loud warning) rather than a hard failure.
export const PINNED_PUBKEYS: string[] = [
  // PLACEHOLDER — replace with real minisign public key line(s) before shipping.
  // Format: two lines — untrusted comment line + base64 payload line.
  // Example:
  //   "untrusted comment: minisign public key XXXXXXXXXXXXXXXX\nRWS...<base64>",
];

// Returns true when at least one real key is pinned.
export function hasPinnedKey(): boolean {
  return PINNED_PUBKEYS.length > 0;
}
