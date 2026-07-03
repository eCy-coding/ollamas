// Operator ed25519 identity for signing invites (vK17). Stored 0600 like the
// member identity (cli.ts loadOrCreateIdentity) — plaintext-0600, NOT sealed:
// same protection level as the existing member key (backups/casual reads/accidental
// commits), and zero-dep. HONEST LIMIT (RISK-K18): 0600 does not stop a local
// attacker who already has the file; a passphrase/Keychain would break "0 manuel".
// `epoch` bumps on rotation → rotating the key invalidates ALL outstanding invites
// (the invite kill switch, verifyInvite rejects a stale epoch).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { generateIdentity } from "./identity.ts";

export type OperatorKey = { privateKeyPem: string; publicKeyHex: string; epoch: number };

export function defaultOperatorKeyPath(): string {
  return process.env.CONTRACT_OPERATOR_KEY || join(homedir(), ".ollamas", "contract-operator-key.json");
}

function writeAtomic(path: string, obj: OperatorKey): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.opkey-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function loadOrCreateOperatorKey(path = defaultOperatorKeyPath()): OperatorKey {
  try {
    const k = JSON.parse(readFileSync(path, "utf8")) as OperatorKey;
    if (k.privateKeyPem && k.publicKeyHex && Number.isFinite(k.epoch)) return k;
  } catch { /* missing/corrupt → create */ }
  const id = generateIdentity();
  const key: OperatorKey = { privateKeyPem: id.privateKeyPem, publicKeyHex: id.publicKeyHex, epoch: 1 };
  writeAtomic(path, key);
  return key;
}

/** Kill switch: mint a fresh key with epoch+1 → every outstanding invite (signed by
 * the old key / stamped with the old epoch) fails verifyInvite immediately. */
export function rotateOperatorKey(path = defaultOperatorKeyPath()): OperatorKey {
  let prevEpoch = 0;
  try { prevEpoch = (JSON.parse(readFileSync(path, "utf8")) as OperatorKey).epoch || 0; } catch { /* none */ }
  const id = generateIdentity();
  const key: OperatorKey = { privateKeyPem: id.privateKeyPem, publicKeyHex: id.publicKeyHex, epoch: prevEpoch + 1 };
  writeAtomic(path, key);
  return key;
}
