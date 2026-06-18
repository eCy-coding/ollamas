#!/usr/bin/env node
// Generate cross-language HMAC test vectors from the single-source signer
// (../host-bridge/hmac.mjs). The Swift mirror (OllamasKit) and a node drift
// test both assert against the committed hmac-vectors.json. If hmac.mjs ever
// changes, regenerate and BOTH sides catch the drift.
//   node gen-vectors.mjs            # print JSON
//   node gen-vectors.mjs --write    # overwrite hmac-vectors.json
import { canonicalMessage, computeSignature } from "../host-bridge/hmac.mjs";
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

export function buildVectors() {
  return {
    secret: SECRET,
    algorithm: "HMAC-SHA256/hex",
    vectors: INPUTS.map((i) => ({
      ...i,
      canonical: canonicalMessage(i.method, i.path, i.body, i.timestamp, i.nonce),
      signature: computeSignature(SECRET, i.method, i.path, i.body, i.timestamp, i.nonce),
    })),
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
