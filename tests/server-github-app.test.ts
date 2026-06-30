import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { buildAppJwt, verifyWebhookSignature, getAppCreds } from "../server/github-app";

// A throwaway RSA keypair for signing assertions (never a real App key).
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

describe("github-app — buildAppJwt (RS256)", () => {
  it("emits a 3-part JWT with the right claims, RS256-verifiable", () => {
    const now = 1_700_000_000;
    const jwt = buildAppJwt("123456", pem, now);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("123456");
    expect(payload.iat).toBe(now - 60);
    expect(payload.exp).toBe(now + 600);
    // signature verifies against the public key
    const ok = crypto.createVerify("RSA-SHA256").update(`${parts[0]}.${parts[1]}`).verify(publicKey, Buffer.from(parts[2], "base64url"));
    expect(ok).toBe(true);
  });

  it("throws on an invalid private key", () => {
    expect(() => buildAppJwt("1", "not-a-key", 1)).toThrow();
  });
});

describe("github-app — verifyWebhookSignature (HMAC, constant-time)", () => {
  const secret = "s3cr3t";
  const body = Buffer.from('{"action":"opened"}');
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(secret, Buffer.from('{"action":"closed"}'), sig)).toBe(false);
  });
  it("rejects a wrong secret + missing header", () => {
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false);
    expect(verifyWebhookSignature("", body, sig)).toBe(false);
  });
});

describe("github-app — getAppCreds graceful", () => {
  it("returns null when the App slots are empty (vault has no github-app-* keys in test)", () => {
    // In the test env the vault has no github-app-id → creds absent → null (graceful skip path).
    expect(getAppCreds()).toBeNull();
  });
});
