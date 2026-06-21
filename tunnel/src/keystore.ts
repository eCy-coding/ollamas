// Keystore — auto-keyfile + encrypted vault. ZERO manual (no passphrase prompt, vT5).
// The master key is an auto-generated 32-byte keyfile (0600); if absent it is created.
// Secrets are sealed with crypto.ts (AES-256-GCM) into a JSON vault file.
//
// HONEST LIMITATION (RISK-TUNNEL-014): the keyfile lives under keys/ alongside the vault.
// This protects against casual disk reads / backup leaks / accidental commits — NOT against a
// local attacker who already has the keyfile. A passphrase or macOS Keychain would be stronger
// but would require manual input (violating the "0 manuel" constraint). Documented, not overclaimed.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { Buffer } from "node:buffer";
import { open, seal, type Sealed } from "./crypto.ts";

/** Load the 32-byte master key, creating it (0600) on first use. No prompt. */
export function loadOrCreateKeyfile(path: string): Buffer {
  if (existsSync(path)) {
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error(`keyfile ${path} corrupt: expected 32 bytes, got ${key.length}`);
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600 });
  chmodSync(path, 0o600); // enforce even if umask interfered
  return key;
}

/** Seal an object → encrypted JSON vault file (0600). */
export function sealToFile(path: string, obj: unknown, key: Buffer): void {
  const sealed = seal(JSON.stringify(obj), key);
  writeFileSync(path, JSON.stringify(sealed), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Open an encrypted vault file → object, or null on any failure (missing / corrupt / wrong key).
 * Graceful-degrade (CLI lane N-013 lesson): a broken vault never crashes the caller.
 */
export function openFromFile<T = unknown>(path: string, key: Buffer): T | null {
  try {
    if (!existsSync(path)) return null;
    const sealed = JSON.parse(readFileSync(path, "utf8")) as Sealed;
    return JSON.parse(open(sealed, key)) as T;
  } catch {
    return null;
  }
}
