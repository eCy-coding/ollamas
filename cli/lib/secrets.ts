// Secret sealing — PURE AES-256-GCM seal/open (v7). Zero-dep (node:crypto only).
// Mirrors the server's vault format (server/db.ts:155-187) so the scheme is one
// we already trust: random 12-byte IV, 16-byte auth tag pinned via authTagLength
// (avoids the gcm-no-tag-length forgery class — Node #52327), serialized as
// `iv:tag:ciphertext` hex. NO server import — the pattern is ported, the choke-
// point law holds.
//
// DELIBERATE DIVERGENCE from db.ts: open() THROWS on any failure. db.ts.decrypt
// swallows errors and returns "" — fine for a server cache, dangerous for a CLI
// that would then send an EMPTY string as a Bearer key (silent 401, or worse a
// request with no auth). A caller must distinguish "no secret" from "corrupt
// secret"; an exception forces that.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

// Encrypt a UTF-8 string with a 32-byte key. Empty input → empty output (an
// absent secret is not an error). Returns `iv:tag:ciphertext`, all hex.
export function seal(plaintext: string, key: Buffer): string {
  if (!plaintext) return "";
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  const ct = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${ct}`;
}

// Decrypt a blob produced by seal(). Empty → empty. THROWS SecretError on a
// malformed blob, a short/forged tag, or an authentication failure (wrong key /
// tampered ciphertext) — never returns a partial or empty plaintext on failure.
export function open(blob: string, key: Buffer): string {
  if (!blob) return "";
  const parts = blob.split(":");
  if (parts.length !== 3) throw new SecretError("malformed secret blob (expected iv:tag:ciphertext)");
  const [ivHex, tagHex, ct] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (iv.length !== IV_BYTES) throw new SecretError("bad IV length");
  if (tag.length !== TAG_BYTES) throw new SecretError("bad auth tag length (forgery guard)");
  try {
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return decipher.update(ct, "hex", "utf8") + decipher.final("utf8");
  } catch {
    // GCM final() throws when the tag doesn't verify → wrong key or tampered data.
    throw new SecretError("secret decryption failed (wrong key or tampered data)");
  }
}

// Derive a 32-byte key from a passphrase + salt via scrypt — the OLLAMAS_PASSPHRASE
// path, where the key never touches disk. Synchronous (CLI startup, one call).
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}
