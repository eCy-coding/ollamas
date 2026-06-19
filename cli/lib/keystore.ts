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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { deriveKey } from "./secrets";

const KEY_BYTES = 32;
const SALT_BYTES = 16;

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

// Resolve the 32-byte master key. Called lazily — only when a secret is actually
// sealed or opened — so keyless users never get a keyfile written.
export function loadMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const pass = env.OLLAMAS_PASSPHRASE;
  if (pass) return deriveKey(pass, loadOrCreateSalt());
  return loadOrCreateKeyfile();
}
