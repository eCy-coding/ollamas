// GW-2 gateway verify (v1.29.3): HMAC-SHA256 host-bridge signing.
// Proves the mjs signer/verifier is correct against known-answer vectors AND
// byte-identical to the TS side (server/bridge-hmac.ts) — the two impls MUST
// never drift because the server (TS) signs and the bridge (mjs) verifies.
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

import {
  canonicalMessage as mjsCanonical,
  computeSignature as mjsSign,
  hmacSha256Hex,
  verifyHmacHeaders,
  HMAC_WINDOW_MS as MJS_WINDOW,
} from "./hmac.mjs";

import {
  canonicalMessage as tsCanonical,
  signRequest as tsSign,
  verifyRequest as tsVerify,
  HMAC_WINDOW_MS as TS_WINDOW,
} from "../../server/bridge-hmac.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VF = JSON.parse(readFileSync(path.join(HERE, "hmac-vectors.json"), "utf8"));

describe("host-bridge HMAC — known-answer vectors", () => {
  test("fixture has vectors + KATs", () => {
    expect(VF.vectors.length).toBeGreaterThan(0);
    expect(VF.kats.length).toBeGreaterThan(0);
  });

  test("mjs canonical message matches every fixture vector", () => {
    for (const v of VF.vectors) {
      expect(mjsCanonical(v.method, v.path, v.body, v.timestamp, v.nonce)).toBe(v.canonical);
    }
  });

  test("mjs computeSignature matches every fixture signature", () => {
    for (const v of VF.vectors) {
      expect(mjsSign(VF.secret, v.method, v.path, v.body, v.timestamp, v.nonce)).toBe(v.signature);
    }
  });

  test("hmacSha256Hex reproduces the RFC 4231 KATs byte-for-byte", () => {
    for (const k of VF.kats) {
      const mac = hmacSha256Hex(Buffer.from(k.keyHex, "hex"), Buffer.from(k.dataHex, "hex"));
      expect(mac).toBe(k.mac);
    }
  });
});

describe("host-bridge HMAC — TS <-> mjs parity", () => {
  test("HMAC_WINDOW_MS constant is identical on both sides", () => {
    expect(MJS_WINDOW).toBe(TS_WINDOW);
    expect(MJS_WINDOW).toBe(5 * 60 * 1000);
  });

  test("canonical message is byte-identical for every fixture vector", () => {
    for (const v of VF.vectors) {
      expect(mjsCanonical(v.method, v.path, v.body, v.timestamp, v.nonce)).toBe(
        tsCanonical(v.method, v.path, v.body, v.timestamp, v.nonce)
      );
    }
  });

  test("TS signer -> mjs verifier accepts (server signs, bridge verifies)", () => {
    const body = JSON.stringify({ command: "ls" });
    const sig = tsSign(VF.secret, "POST", "/exec", body);
    const seen = new Set();
    expect(verifyHmacHeaders(VF.secret, { method: "POST", path: "/exec", body, ...sig }, seen)).toBe(true);
  });

  test("mjs signer -> TS verifier accepts (reverse direction)", () => {
    const body = JSON.stringify({ command: "ls" });
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(12).toString("hex");
    const signature = mjsSign(VF.secret, "POST", "/exec", body, timestamp, nonce);
    const seen = new Set();
    expect(tsVerify(VF.secret, { method: "POST", path: "/exec", body, signature, timestamp, nonce }, seen)).toBe(true);
  });
});

describe("host-bridge HMAC — mjs verify guards", () => {
  const SECRET = "gw2-verify-secret";
  const fresh = (over = {}) => {
    const body = "{}";
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(8).toString("hex");
    const signature = mjsSign(SECRET, "POST", "/run", body, timestamp, nonce);
    return { method: "POST", path: "/run", body, signature, timestamp, nonce, ...over };
  };

  test("valid signature verifies", () => {
    expect(verifyHmacHeaders(SECRET, fresh(), new Set())).toBe(true);
  });

  test("replayed nonce is rejected on second use", () => {
    const seen = new Set();
    const h = fresh();
    expect(verifyHmacHeaders(SECRET, h, seen)).toBe(true);
    expect(verifyHmacHeaders(SECRET, h, seen)).toBe(false);
  });

  test("tampered body is rejected", () => {
    const h = fresh();
    expect(verifyHmacHeaders(SECRET, { ...h, body: JSON.stringify({ command: "rm -rf /" }) }, new Set())).toBe(false);
  });

  test("wrong secret is rejected", () => {
    expect(verifyHmacHeaders("other-secret", fresh(), new Set())).toBe(false);
  });

  test("stale timestamp (outside window) is rejected", () => {
    const staleTs = String(Date.now() - 10 * 60 * 1000);
    const nonce = "stale-n";
    const signature = mjsSign(SECRET, "POST", "/run", "{}", staleTs, nonce);
    expect(verifyHmacHeaders(SECRET, { method: "POST", path: "/run", body: "{}", signature, timestamp: staleTs, nonce }, new Set())).toBe(false);
  });

  test("missing signature/timestamp/nonce fields are rejected", () => {
    const h = fresh();
    expect(verifyHmacHeaders(SECRET, { ...h, signature: "" }, new Set())).toBe(false);
    expect(verifyHmacHeaders(SECRET, { ...h, timestamp: "" }, new Set())).toBe(false);
    expect(verifyHmacHeaders(SECRET, { ...h, nonce: "" }, new Set())).toBe(false);
  });
});
