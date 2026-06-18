// HMAC-SHA256 host-bridge signing — single source of truth (mjs side).
// Byte-identical mirror of server/bridge-hmac.ts canonical message. The server
// (TS) signs; this lib (consumed by terminal-bridge.mjs) verifies. Keeping ONE
// canonicalMessage on the mjs side removes the TS↔mjs drift the inline copies
// invited. WHY a separate file: terminal-bridge.mjs starts an HTTP server at
// import time, so tests must import these pure fns from here, not from there.

import crypto from "node:crypto";

export const HMAC_WINDOW_MS = 5 * 60 * 1000;

/** Canonical signed message — KEEP IDENTICAL to server/bridge-hmac.ts. */
export function canonicalMessage(method, path, body, timestamp, nonce) {
  return `${method.toUpperCase()}\n${path}\n${body}\n${timestamp}\n${nonce}`;
}

/** HMAC-SHA256 hex signature over the canonical message. */
export function computeSignature(secret, method, path, body, timestamp, nonce) {
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalMessage(method, path, body, timestamp, nonce))
    .digest("hex");
}

/**
 * Verify a signed request from its header fields. `seenNonces` (caller-owned
 * Set) blocks replays. Returns true only on fresh, untampered, non-replayed
 * signatures. Constant-time signature comparison.
 */
export function verifyHmacHeaders(secret, { method, path, body, signature, timestamp, nonce }, seenNonces) {
  if (!signature || !timestamp || !nonce) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > HMAC_WINDOW_MS) return false; // stale window
  if (seenNonces.has(nonce)) return false; // replay
  const expected = computeSignature(secret, method, path, body, timestamp, nonce);
  const a = Buffer.from(String(signature)), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  seenNonces.add(nonce);
  setTimeout(() => seenNonces.delete(nonce), HMAC_WINDOW_MS).unref?.();
  return true;
}
