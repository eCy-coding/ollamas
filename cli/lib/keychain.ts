// macOS Keychain master-key backend (v11). Zero-dep shell-out to /usr/bin/security
// (generic-password CRUD). It holds the 32-byte MASTER KEY only — the individual
// secrets stay AES-256-GCM-sealed on disk (lib/secrets.ts, v7); v11 changes only
// WHERE the key lives, not the sealing. The key is a 32-byte Buffer either way, so
// lib/secrets.ts seal/open and lib/config.ts are untouched (key-source-agnostic).
//
// Adopted recipe (MIT, pattern-only — no vendored source): 99designs/aws-vault +
// sorah/envchain (generic-password per service/account) + r-lib/keyring
// (always-degrade to null on any failure). keytar is archived + a native addon, so
// we shell out instead — keeps the zero-dep law.
//
// Honest tradeoff (see cli/KEYCHAIN.md): `security add-generic-password -w <b64key>`
// makes the key briefly visible in `ps` (~100ms) ONCE, at write time — `security`
// has no stdin/file input. READ (`find -w`) does NOT expose the key. Accepted for a
// local zero-dep CLI; we do not force `-A` (allow-any-app), which would weaken the ACL.
import { execFileSync } from "node:child_process";

const SECURITY = "/usr/bin/security";
export const SERVICE = "ollamas";
export const ACCOUNT = "master-key";
const KEY_BYTES = 32;
const TIMEOUT_MS = 5000; // a hung keychain prompt must not block the CLI

export type KeychainOp = "read" | "write" | "delete";

// Build the argv for /usr/bin/security. Pure → unit-testable, no I/O. The base64
// secret is the LAST element on write so a test can assert the whole structure
// without the secret appearing in any earlier position. `-U` upserts (update if the
// item already exists) so a re-write never errors.
export function buildSecurityArgs(op: KeychainOp, service: string, account: string, b64?: string): string[] {
  switch (op) {
    case "read":
      return ["find-generic-password", "-s", service, "-a", account, "-w"];
    case "delete":
      return ["delete-generic-password", "-s", service, "-a", account];
    case "write":
      return ["add-generic-password", "-U", "-s", service, "-a", account, "-w", b64 ?? ""];
  }
}

// The keychain backend exists only on macOS. Everywhere else (Linux/CI/Windows)
// every call below short-circuits to a miss and the caller uses the keyfile.
export function keychainAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

// Read the 32-byte master key from the login keychain. Returns null on ANY failure
// — not-found, non-darwin, locked keychain, SSH session, timeout, or a stored value
// that isn't exactly 32 bytes — so the caller can fall back to the keyfile. stderr
// is discarded (a not-found prints to stderr with a non-zero exit).
export function readMasterKey(service = SERVICE, account = ACCOUNT): Buffer | null {
  if (!keychainAvailable()) return null;
  try {
    const out = execFileSync(SECURITY, buildSecurityArgs("read", service, account), {
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (!out) return null;
    const key = Buffer.from(out, "base64");
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}

// Store the 32-byte key (base64). Returns false on any failure so the caller can
// fall back to the keyfile (e.g. SSH/locked keychain refuses the write). `-U`
// upserts, so re-writing an existing item succeeds instead of erroring.
export function writeMasterKey(key: Buffer, service = SERVICE, account = ACCOUNT): boolean {
  if (!keychainAvailable()) return false;
  try {
    execFileSync(SECURITY, buildSecurityArgs("write", service, account, key.toString("base64")), {
      timeout: TIMEOUT_MS,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Remove the keychain item. Returns false if it was absent or the delete failed.
export function deleteMasterKey(service = SERVICE, account = ACCOUNT): boolean {
  if (!keychainAvailable()) return false;
  try {
    execFileSync(SECURITY, buildSecurityArgs("delete", service, account), {
      timeout: TIMEOUT_MS,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
