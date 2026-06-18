// HMAC-SHA256 request signing for the host-bridge (Faz 10E). The server signs
// {method, path, body, timestamp, nonce}; the bridge verifies signature +
// freshness (±5 min) + nonce non-replay. Mirror impl lives in
// bin/host-bridge/hmac.mjs (MUST stay byte-identical in message construction).

import crypto from "node:crypto";

export const HMAC_WINDOW_MS = 5 * 60 * 1000;

/** Canonical signed message — KEEP IDENTICAL to bin/host-bridge/hmac.mjs. */
export function canonicalMessage(method: string, path: string, body: string, timestamp: string, nonce: string): string {
  return `${method.toUpperCase()}\n${path}\n${body}\n${timestamp}\n${nonce}`;
}

export function signRequest(secret: string, method: string, path: string, body: string): { signature: string; timestamp: string; nonce: string } {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(12).toString("hex");
  const signature = crypto.createHmac("sha256", secret).update(canonicalMessage(method, path, body, timestamp, nonce)).digest("hex");
  return { signature, timestamp, nonce };
}

export interface SignedHeaders {
  method: string; path: string; body: string;
  signature?: string; timestamp?: string; nonce?: string;
}

/** Verify a signed request. `seenNonces` (caller-owned Set) blocks replays. */
export function verifyRequest(secret: string, h: SignedHeaders, seenNonces: Set<string>): boolean {
  if (!h.signature || !h.timestamp || !h.nonce) return false;
  const ts = parseInt(h.timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > HMAC_WINDOW_MS) return false; // stale/replayed window
  if (seenNonces.has(h.nonce)) return false; // replay
  const expected = crypto.createHmac("sha256", secret).update(canonicalMessage(h.method, h.path, h.body, h.timestamp, h.nonce)).digest("hex");
  const a = Buffer.from(h.signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  seenNonces.add(h.nonce);
  setTimeout(() => seenNonces.delete(h.nonce!), HMAC_WINDOW_MS).unref?.();
  return true;
}
