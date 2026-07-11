// O8 settings module — dep-free RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation.
// Zero external deps (node:crypto only, PIPELINE-LESSONS zero-dep discipline);
// verified against the official RFC 6238 Appendix B test vectors in
// tests/modules/settings.test.ts (SHA1, 8-digit, T0=0, step=30). Real-world
// enrollment uses 6-digit codes (authenticator-app default) — `digits` is a
// parameter so both are the SAME code path, not two implementations.
import crypto from "node:crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 encode, no padding (20 random bytes → 32 chars, matches
 *  authenticator-app "setup key" convention). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** RFC 4648 base32 decode — tolerant of lowercase / stray non-alphabet chars
 *  (users often paste "setup keys" with spaces). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a fresh random TOTP secret, base32-encoded (default 20 bytes →
 *  32 base32 chars, per docs/odyssey/07-security.md O8.1 step 1). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

/** RFC 4226 HOTP: HMAC-SHA1 dynamic truncation over an 8-byte big-endian counter. */
function hotp(key: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) >>>
    0;
  const mod = 10 ** digits;
  return String(code % mod).padStart(digits, "0");
}

export interface TotpOpts {
  digits?: number;
  step?: number;
  /** Unix time in SECONDS (not ms) — defaults to now. */
  time?: number;
}

/** RFC 6238 TOTP at the current (or given) time step. */
export function totp(secretBase32: string, opts: TotpOpts = {}): string {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const t = opts.time ?? Date.now() / 1000;
  const counter = Math.floor(t / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

export interface VerifyOpts extends TotpOpts {
  /** Number of steps of drift tolerance on either side (default 1, i.e. ±30s). */
  window?: number;
}

/** Verify a token against a ±window step tolerance. Returns the matched time-step
 *  counter (for stateful replay-guarding by the caller) or null if no match. Pure
 *  and stateless — replay protection is layered on top by server/modules/settings/service.ts,
 *  which remembers the last-consumed counter per enrollment. */
export function verifyTotp(secretBase32: string, token: string, opts: VerifyOpts = {}): number | null {
  if (typeof token !== "string" || !/^\d+$/.test(token)) return null;
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  const t = opts.time ?? Date.now() / 1000;
  const counter0 = Math.floor(t / step);
  const key = base32Decode(secretBase32);
  for (let w = -window; w <= window; w++) {
    const c = counter0 + w;
    if (hotp(key, c, digits) === token) return c;
  }
  return null;
}

/** Build an otpauth:// URL for QR-code enrollment (no QR image lib — the
 *  frontend renders this string via any client-side QR component / manual entry;
 *  no new npm dep, PIPELINE-LESSONS zero-dep discipline). */
export function otpauthUrl(opts: { issuer: string; account: string; secret: string; digits?: number; period?: number }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(opts.digits ?? 6),
    period: String(opts.period ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Cryptographically random backup codes (10 groups of 10 alnum chars by default). */
export function generateBackupCodes(count = 10, groupLen = 10): string[] {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I — human transcription
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(groupLen);
    let code = "";
    for (let j = 0; j < groupLen; j++) code += alphabet[bytes[j] % alphabet.length];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/** SHA-256 hash for at-rest backup-code storage (one-way; codes are single-use
 *  and shown to the user exactly once at generation time). */
export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
