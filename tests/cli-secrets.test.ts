import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, open, deriveKey, SecretError } from "../cli/lib/secrets";

const key = randomBytes(32);

describe("seal/open round-trip", () => {
  it("recovers the plaintext with the same key", () => {
    const blob = seal("olm_secret_value", key);
    expect(open(blob, key)).toBe("olm_secret_value");
  });

  it("produces the iv:tag:ciphertext hex shape (mirrors server/db.ts)", () => {
    const blob = seal("x", key);
    const parts = blob.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag
    expect(parts[2]).toMatch(/^[0-9a-f]*$/);
  });

  it("a fresh IV each call → ciphertext differs for identical input", () => {
    expect(seal("same", key)).not.toBe(seal("same", key));
  });

  it("empty plaintext seals to empty, opens to empty", () => {
    expect(seal("", key)).toBe("");
    expect(open("", key)).toBe("");
  });

  it("round-trips unicode + colons in the plaintext", () => {
    const secret = "üç:iki:bir — 🔑";
    expect(open(seal(secret, key), key)).toBe(secret);
  });
});

describe("open throws (never silent-empty — unlike db.ts)", () => {
  it("throws SecretError on a wrong key", () => {
    const blob = seal("v", key);
    expect(() => open(blob, randomBytes(32))).toThrow(SecretError);
  });

  it("throws on a flipped auth-tag byte (tamper)", () => {
    const [iv, tag, ct] = seal("v", key).split(":");
    const flipped = (tag[0] === "a" ? "b" : "a") + tag.slice(1);
    expect(() => open(`${iv}:${flipped}:${ct}`, key)).toThrow(SecretError);
  });

  it("throws on a flipped ciphertext byte (tamper)", () => {
    const [iv, tag, ct] = seal("value", key).split(":");
    const flipped = (ct[0] === "a" ? "b" : "a") + ct.slice(1);
    expect(() => open(`${iv}:${tag}:${flipped}`, key)).toThrow(SecretError);
  });

  it("throws on a malformed blob (not 3 parts)", () => {
    expect(() => open("notavalidblob", key)).toThrow(SecretError);
    expect(() => open("a:b", key)).toThrow(SecretError);
  });

  it("throws on a short auth tag (forgery guard)", () => {
    const [iv, , ct] = seal("v", key).split(":");
    expect(() => open(`${iv}:dead:${ct}`, key)).toThrow(SecretError);
  });
});

describe("deriveKey (scrypt, passphrase path)", () => {
  it("is deterministic for the same passphrase + salt", () => {
    const salt = randomBytes(16);
    expect(deriveKey("hunter2", salt).equals(deriveKey("hunter2", salt))).toBe(true);
  });

  it("yields a 32-byte key", () => {
    expect(deriveKey("p", randomBytes(16)).length).toBe(32);
  });

  it("different passphrase or salt → different key", () => {
    const salt = randomBytes(16);
    expect(deriveKey("a", salt).equals(deriveKey("b", salt))).toBe(false);
    expect(deriveKey("a", randomBytes(16)).equals(deriveKey("a", randomBytes(16)))).toBe(false);
  });

  it("a passphrase-derived key seals/opens end-to-end", () => {
    const salt = randomBytes(16);
    const k = deriveKey("correct horse", salt);
    expect(open(seal("battery staple", k), k)).toBe("battery staple");
  });
});
