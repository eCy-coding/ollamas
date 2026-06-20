// AES-256-GCM seal/open — PURE (deterministic given key+iv). Zero-dep node:crypto.
// Adoption (pattern only): AndiDittrich/rjz GCM gists + Node crypto docs + this repo's CLI lane
// (authTagLength:16, decrypt-degrade N-013). 12-byte random IV, 16-byte auth tag, base64 envelope.
// open() THROWS on any tamper (wrong key / flipped byte) — callers graceful-degrade (keystore).

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export interface Sealed {
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes (authTagLength)
  ct: string; // base64 ciphertext
}

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended
const TAG_LEN = 16; // 128-bit auth tag

function assertKey(key: Buffer): void {
  if (key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} bytes (AES-256), got ${key.length}`);
}

/** Encrypt utf8 plaintext → {iv,tag,ct} base64 envelope. iv injectable for deterministic tests. */
export function seal(plaintext: string, key: Buffer, opts: { iv?: Buffer } = {}): Sealed {
  assertKey(key);
  const iv = opts.iv ?? randomBytes(IV_LEN);
  if (iv.length !== IV_LEN) throw new Error(`iv must be ${IV_LEN} bytes`);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

/** Decrypt a {iv,tag,ct} envelope → utf8. THROWS on tamper / wrong key (auth tag mismatch). */
export function open(sealed: Sealed, key: Buffer): string {
  assertKey(key);
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]);
  return pt.toString("utf8");
}
