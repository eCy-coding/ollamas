import { describe, test, expect } from "vitest";
import { db } from "../server/db";

// Faz 9A: AES-256-GCM auth-tag pinned to 16 bytes; short/forged tags rejected.
describe("GCM auth-tag hardening", () => {
  test("encrypt → decrypt round-trips", () => {
    const secret = "tenant-credential-value-2026";
    const blob = db.encrypt(secret);
    expect(db.decrypt(blob)).toBe(secret);
  });

  test("a truncated auth tag is rejected (returns empty, no forgery)", () => {
    const blob = db.encrypt("opaque-token-xyz");
    const [iv, , enc] = blob.split(":");
    const shortTag = "00".repeat(8); // 8 bytes — below the pinned 16
    expect(db.decrypt(`${iv}:${shortTag}:${enc}`)).toBe("");
  });

  test("a tampered ciphertext fails authentication (empty)", () => {
    const blob = db.encrypt("opaque-token-xyz");
    const [iv, tag, enc] = blob.split(":");
    const flipped = (enc[0] === "a" ? "b" : "a") + enc.slice(1);
    expect(db.decrypt(`${iv}:${tag}:${flipped}`)).toBe("");
  });
});
