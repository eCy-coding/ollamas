import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_VERSION, renderContract, canonicalHash, currentContractHash } from "./contractdoc.ts";

test("renderContract contains version, obligations and revocation sections", () => {
  const doc = renderContract();
  assert.ok(doc.includes(CONTRACT_VERSION));
  assert.ok(/api key/i.test(doc));
  assert.ok(/revo/i.test(doc)); // revocation / revoke
  assert.ok(/pool/i.test(doc));
});

test("canonicalHash is deterministic and whitespace-normalized", () => {
  const a = canonicalHash("hello  \nworld  ");
  const b = canonicalHash("hello\nworld");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("different text produces different hash", () => {
  assert.notEqual(canonicalHash("a"), canonicalHash("b"));
});

test("currentContractHash matches hash of rendered document", () => {
  assert.equal(currentContractHash(), canonicalHash(renderContract()));
});
