import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_VERSION, renderContract, canonicalHash, currentContractHash } from "./contractdoc.ts";

test("renderContract v2 covers all shipped capabilities + solo operation", () => {
  const doc = renderContract();
  assert.equal(CONTRACT_VERSION, "2.0.0");
  assert.ok(doc.includes(CONTRACT_VERSION));
  assert.ok(/api key/i.test(doc));
  assert.ok(/revo/i.test(doc));
  assert.ok(/pool/i.test(doc));
  // vK18 new sections
  assert.ok(/solo/i.test(doc), "solo-operator clause");
  assert.ok(/rotat/i.test(doc), "key rotation");
  assert.ok(/resume/i.test(doc), "suspend/resume");
  assert.ok(/quota/i.test(doc) && /success/i.test(doc), "quota charge-on-success");
  assert.ok(/invite/i.test(doc), "invite onboarding");
  assert.ok(/rpc-server|shard|split/i.test(doc), "multi-machine sharding");
  assert.ok(/private\/mesh|mesh network|private\/mesh networks/i.test(doc), "private/mesh only");
  assert.ok(/audit/i.test(doc) && /secret-free/i.test(doc), "audit secret-free");
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
