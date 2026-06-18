// Scripts domain v2 — HMAC cross-implementation parity.
// Locks the TS signer (server/bridge-hmac.ts) byte-identical to the mjs verifier
// (bin/host-bridge/hmac.mjs). server/bridge-hmac.ts:4 promised this mirror; v2
// realizes it as a single source and guards the drift here.
import { describe, test, expect } from "vitest";
import {
  canonicalMessage as tsCanon,
  signRequest,
  HMAC_WINDOW_MS as tsWindow,
} from "../../server/bridge-hmac";

const mjs = await import("../../bin/host-bridge/hmac.mjs");
const SECRET = "test-secret-key";

// Adversarial inputs: the canonical message joins on \n, so embedded newlines,
// empty fields, unicode and method-casing are exactly where two impls drift.
const CASES: Array<[string, string, string, string, string]> = [
  ["POST", "/run", "", "1700000000000", "abc123"],
  ["post", "/exec", '{"command":"ls"}', "1700000000000", "deadbeef"],
  ["GET", "/health", "body\nwith\nnewlines", "1700000000001", "n1"],
  ["POST", "/write", "ünïcödé→📦", "1700000000002", "n2"],
  ["POST", "/run", "a".repeat(5000), "1700000000003", "n3"],
  ["POST", "/run\nfake", "x", "1700000000004", "n4\nfake"],
];

describe("HMAC TS↔mjs parity", () => {
  test("canonicalMessage byte-identical across all cases", () => {
    for (const [m, p, b, ts, n] of CASES) {
      expect(mjs.canonicalMessage(m, p, b, ts, n)).toBe(tsCanon(m, p, b, ts, n));
    }
  });

  test("HMAC_WINDOW_MS constant matches", () => {
    expect(mjs.HMAC_WINDOW_MS).toBe(tsWindow);
  });

  test("TS signRequest output verifies under mjs verifyHmacHeaders", () => {
    const method = "POST", path = "/run", body = '{"command":"echo hi"}';
    const { signature, timestamp, nonce } = signRequest(SECRET, method, path, body);
    const ok = mjs.verifyHmacHeaders(
      SECRET,
      { method, path, body, signature, timestamp, nonce },
      new Set(),
    );
    expect(ok).toBe(true);
  });

  test("tampered signature is rejected by mjs verify", () => {
    const method = "POST", path = "/run", body = "payload";
    const { signature, timestamp, nonce } = signRequest(SECRET, method, path, body);
    const tampered = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
    const ok = mjs.verifyHmacHeaders(
      SECRET,
      { method, path, body, signature: tampered, timestamp, nonce },
      new Set(),
    );
    expect(ok).toBe(false);
  });

  test("mjs computeSignature equals raw TS HMAC for same canonical input", async () => {
    const crypto = await import("node:crypto");
    const [m, p, b, ts, n] = CASES[1];
    const tsSig = crypto
      .createHmac("sha256", SECRET)
      .update(tsCanon(m, p, b, ts, n))
      .digest("hex");
    expect(mjs.computeSignature(SECRET, m, p, b, ts, n)).toBe(tsSig);
  });
});
