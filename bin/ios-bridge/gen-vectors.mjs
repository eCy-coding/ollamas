#!/usr/bin/env node
// Generate cross-language HMAC test vectors from the single-source signer
// (../host-bridge/hmac.mjs). The Swift mirror (OllamasKit) and a node drift
// test both assert against the committed hmac-vectors.json. If hmac.mjs ever
// changes, regenerate and BOTH sides catch the drift.
//   node gen-vectors.mjs            # print JSON
//   node gen-vectors.mjs --write    # overwrite hmac-vectors.json
import { canonicalMessage, computeSignature, hmacSha256Hex } from "../host-bridge/hmac.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SECRET = "vector-secret-001";
// Adversarial inputs: empty body, unicode, embedded newlines, method casing,
// long body — exactly where a re-implementation drifts.
const INPUTS = [
  { method: "POST", path: "/run", body: "", timestamp: "1700000000000", nonce: "n0" },
  { method: "post", path: "/exec", body: '{"command":"ls"}', timestamp: "1700000000001", nonce: "n1" },
  { method: "GET", path: "/health", body: "a\nb\nc", timestamp: "1700000000002", nonce: "n2" },
  { method: "POST", path: "/write", body: "ünïcödé→📦", timestamp: "1700000000003", nonce: "n3" },
  { method: "POST", path: "/run", body: "x".repeat(4096), timestamp: "1700000000004", nonce: "n4" },
];

// Known-answer tests for the HMAC-SHA256 primitive itself, from RFC 4231
// (the canonical IETF test cases also used by C2SP/wycheproof, Apache-2.0).
// These anchor the primitive to an EXTERNAL reference — the canonical-message
// vectors above only prove self-consistency; these prove correctness. Both JS
// and Swift (CryptoKit) must reproduce `expected` byte-for-byte.
const KATS = [
  { rfc: "4231#1", keyHex: "0b".repeat(20), dataUtf8: "Hi There",
    expected: "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7" },
  { rfc: "4231#2", keyUtf8: "Jefe", dataUtf8: "what do ya want for nothing?",
    expected: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843" },
  { rfc: "4231#3", keyHex: "aa".repeat(20), dataHex: "dd".repeat(50),
    expected: "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe" },
  { rfc: "4231#4", keyHex: "0102030405060708090a0b0c0d0e0f10111213141516171819", dataHex: "cd".repeat(50),
    expected: "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b" },
];

function buildKats() {
  return KATS.map((k) => {
    const key = k.keyHex ? Buffer.from(k.keyHex, "hex") : Buffer.from(k.keyUtf8, "utf8");
    const data = k.dataHex ? Buffer.from(k.dataHex, "hex") : Buffer.from(k.dataUtf8, "utf8");
    const mac = hmacSha256Hex(key, data);
    // Self-check: regeneration can never commit a value that drifts from RFC 4231.
    if (mac !== k.expected) throw new Error(`KAT ${k.rfc} mismatch: got ${mac}, RFC expects ${k.expected}`);
    return { rfc: k.rfc, keyHex: key.toString("hex"), dataHex: data.toString("hex"), mac };
  });
}

export function buildVectors() {
  return {
    secret: SECRET,
    algorithm: "HMAC-SHA256/hex",
    vectors: INPUTS.map((i) => ({
      ...i,
      canonical: canonicalMessage(i.method, i.path, i.body, i.timestamp, i.nonce),
      signature: computeSignature(SECRET, i.method, i.path, i.body, i.timestamp, i.nonce),
    })),
    kats: buildKats(),
  };
}

const json = JSON.stringify(buildVectors(), null, 2) + "\n";
if (process.argv.includes("--write")) {
  const out = join(dirname(fileURLToPath(import.meta.url)), "hmac-vectors.json");
  writeFileSync(out, json);
  console.error(`wrote ${out}`);
} else {
  process.stdout.write(json);
}
