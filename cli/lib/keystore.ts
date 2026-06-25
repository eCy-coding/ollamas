// Master-key resolution for sealed CLI secrets (v7). I/O shell around the pure
// crypto in lib/secrets.ts. Two key sources, both zero-dep:
//
//   1. OLLAMAS_PASSPHRASE  → scrypt(passphrase, persisted-salt). The key never
//      touches disk; only a random salt does. Strongest file-based option;
//      works headless over SSH/CI. Pick this OR the keyfile and stick with it —
//      switching sources makes existing sealed secrets un-openable (SecretError).
//   2. keyfile (default)   → ~/.ollamas/.cli_master_key, 32 random bytes, 0600.
//      Zero friction. Defeats casual disclosure (accidental commit, backup, cat),
//      NOT a local attacker who can read both the keyfile and the blob. See
//      cli/SECRETS.md for the honest threat model.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { deriveKey } from "./secrets";
import { keychainAvailable, readMasterKey, writeMasterKey, deleteMasterKey, SERVICE, ACCOUNT } from "./keychain";

const KEY_BYTES = 32;
const SALT_BYTES = 16;

// Where the 32-byte master key lives. "passphrase" derives it from
// OLLAMAS_PASSPHRASE (never on disk); "keychain" stores it in the macOS login
// keychain (v11); "file" is the v7 0600 keyfile. The choice is persisted in a plain
// .keystore marker (NOT the sealed config — it must be readable before the key exists).
export type KeySource = "passphrase" | "keychain" | "file";

function ollamasDir(): string {
  const dir = join(homedir(), ".ollamas");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function masterKeyPath(): string {
  return join(ollamasDir(), ".cli_master_key");
}
export function saltPath(): string {
  return join(ollamasDir(), ".cli_salt");
}
export function markerPath(): string {
  return join(ollamasDir(), ".keystore");
}

// The persisted key-source choice (set only by an explicit `config keystore` switch).
// Garbage / missing → null so resolveKeySource falls through to its defaults.
export function readMarker(): KeySource | null {
  const p = markerPath();
  if (!existsSync(p)) return null;
  const v = readFileSync(p, "utf8").trim();
  return v === "keychain" || v === "file" ? v : null;
}
export function writeMarker(src: KeySource): void {
  writeFileSync(markerPath(), src + "\n", { mode: 0o600 });
}

// Read an existing salt or create a stable one (0600). The passphrase route
// needs the SAME salt every run so the derived key is reproducible.
function loadOrCreateSalt(): Buffer {
  const p = saltPath();
  if (existsSync(p)) return readFileSync(p);
  const salt = randomBytes(SALT_BYTES);
  writeFileSync(p, salt, { mode: 0o600 });
  return salt;
}

function loadOrCreateKeyfile(): Buffer {
  const p = masterKeyPath();
  if (existsSync(p)) {
    const key = readFileSync(p);
    if (key.length !== KEY_BYTES) {
      throw new Error(`corrupt master key at ${p} (expected ${KEY_BYTES} bytes, got ${key.length})`);
    }
    return key;
  }
  const key = randomBytes(KEY_BYTES);
  writeFileSync(p, key, { mode: 0o600 });
  return key;
}

// Decide WHICH source to use. Pure → unit-testable; the whole v11 safety rests here
// (a wrong source silently orphans every sealed *Enc secret). Precedence:
//   passphrase > explicit-env > marker > existing-keyfile (back-compat) >
//   keychain-default (new macOS) > file.
// An existing keyfile always wins over the keychain default so a v7 user is never
// silently moved; only an explicit env/marker switch (which migrates the SAME key
// bytes) changes the source.
export function resolveKeySource(
  env: NodeJS.ProcessEnv,
  hasKeyfile: boolean,
  keychainOk: boolean,
  marker: KeySource | null,
): KeySource {
  if (env.OLLAMAS_PASSPHRASE) return "passphrase";
  const explicit = env.OLLAMAS_KEYSTORE;
  if (explicit === "file") return "file";
  if (explicit === "keychain") return keychainOk ? "keychain" : "file";
  if (marker === "keychain") return keychainOk ? "keychain" : "file";
  if (marker === "file") return "file";
  if (hasKeyfile) return "file";
  if (keychainOk) return "keychain";
  return "file";
}

// Resolve the 32-byte master key. Called lazily — only when a secret is actually
// sealed or opened — so keyless users never get a key written anywhere. Every
// keychain miss/failure degrades to the keyfile; this never throws.
export function loadMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const src = resolveKeySource(env, existsSync(masterKeyPath()), keychainAvailable(), readMarker());
  if (src === "passphrase") return deriveKey(env.OLLAMAS_PASSPHRASE as string, loadOrCreateSalt());
  if (src === "keychain") {
    const existing = readMasterKey();
    if (existing) return existing;
    // First use on the keychain → generate and store. If the write fails (SSH /
    // locked keychain / no GUI), persist the SAME bytes to the keyfile instead so
    // the source degrades gracefully and sealed secrets stay openable. Never throw.
    const key = randomBytes(KEY_BYTES);
    if (writeMasterKey(key)) {
      writeMarker("keychain");
      return key;
    }
    // keychain write failed (SSH / locked keychain / no GUI) → fall back to a STABLE
    // keyfile key via load-or-create. Writing a fresh random here on each call would
    // mint a DIFFERENT key every time and orphan secrets sealed with the earlier one.
    return loadOrCreateKeyfile();
  }
  return loadOrCreateKeyfile();
}

// Human-readable current source + where the key lives (for `config keystore`).
export function describeKeystore(env: NodeJS.ProcessEnv = process.env): { source: KeySource; detail: string } {
  const source = resolveKeySource(env, existsSync(masterKeyPath()), keychainAvailable(), readMarker());
  const detail =
    source === "passphrase"
      ? "OLLAMAS_PASSPHRASE — scrypt-derived, key never on disk"
      : source === "keychain"
        ? `macOS login keychain (service=${SERVICE}, account=${ACCOUNT})`
        : masterKeyPath();
  return { source, detail };
}

// Move the master key to a new source, carrying the SAME 32 bytes so every sealed
// *Enc secret stays openable. Verify-before-destroy: on a keychain switch we read
// the key back and only then remove the keyfile (N-021 discipline). Refuses while
// OLLAMAS_PASSPHRASE is set (it always wins, so a switch would not take effect).
export function migrateKeySource(
  target: "keychain" | "file",
  env: NodeJS.ProcessEnv = process.env,
): { from: KeySource; to: KeySource } {
  if (env.OLLAMAS_PASSPHRASE) {
    throw new Error("OLLAMAS_PASSPHRASE is set and always takes precedence; unset it before switching keystore");
  }
  const from = resolveKeySource(env, existsSync(masterKeyPath()), keychainAvailable(), readMarker());
  const key = loadMasterKey(env); // current 32-byte key, from whatever source
  if (target === "keychain") {
    if (!keychainAvailable()) throw new Error("the keychain backend is macOS-only");
    if (!writeMasterKey(key)) throw new Error("keychain write failed (locked keychain or non-interactive session)");
    const back = readMasterKey();
    if (!back || !back.equals(key)) throw new Error("keychain read-back verification failed — keyfile left intact");
    writeMarker("keychain");
    if (existsSync(masterKeyPath())) rmSync(masterKeyPath()); // key now safely in the keychain
  } else {
    writeFileSync(masterKeyPath(), key, { mode: 0o600 });
    writeMarker("file");
    deleteMasterKey(); // drop the keychain copy so the move is clean
  }
  return { from, to: target };
}
