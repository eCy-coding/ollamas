import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "./identity.ts";
import { mintInvite } from "./invite.ts";
import { runBootstrap, decodeInviteServerUrl } from "./bootstrap.ts";

function tokenFor(serverUrl: string, model?: string): string {
  const op = generateIdentity();
  const now = Date.now();
  return mintInvite({
    v: 1, jti: "j1", iat: new Date(now).toISOString(), expiresAt: new Date(now + 900000).toISOString(),
    quotaReqPerDay: 500, allowedModel: model, contractHash: "c".repeat(64), serverUrl, epoch: 1,
  }, op.privateKeyPem);
}

test("decodeInviteServerUrl extracts serverUrl + model from the token body (no verify)", () => {
  const t = tokenFor("http://100.64.0.1:3000", "qwen3:4b");
  const d = decodeInviteServerUrl(t);
  assert.equal(d?.serverUrl, "http://100.64.0.1:3000");
  assert.equal(d?.allowedModel, "qwen3:4b");
});

test("runBootstrap: ordered steps mesh→build→apply→offer; reports each", async () => {
  const order: string[] = [];
  const r = await runBootstrap({
    invite: tokenFor("http://100.64.0.1:3000", "qwen3:4b"),
    steps: {
      meshJoin: async () => { order.push("mesh"); return "joined 100.64.0.9"; },
      ensureRpc: async () => { order.push("build"); return "rpc-server present"; },
      applyWithInvite: async (url, tok, model) => { order.push(`apply:${url}:${model}`); return "olm_KEY"; },
      offer: async (model) => { order.push(`offer:${model}`); return 0; },
    },
  });
  assert.deepEqual(order, ["mesh", "build", "apply:http://100.64.0.1:3000:qwen3:4b", "offer:qwen3:4b"]);
  assert.equal(r.ok, true);
  assert.equal(r.memberKeyDelivered, true);
});

test("runBootstrap: a failing step stops the chain, ok:false, actionable reason", async () => {
  const order: string[] = [];
  const r = await runBootstrap({
    invite: tokenFor("http://100.64.0.1:3000"),
    steps: {
      meshJoin: async () => { order.push("mesh"); return "ok"; },
      ensureRpc: async () => { throw new Error("cmake missing"); },
      applyWithInvite: async () => { order.push("apply"); return "olm_x"; },
      offer: async () => { order.push("offer"); return 0; },
    },
  });
  assert.deepEqual(order, ["mesh"]); // stopped after build failure
  assert.equal(r.ok, false);
  assert.match(r.reason || "", /build|cmake/i);
});

test("runBootstrap: malformed invite → ok:false before any step", async () => {
  let ran = false;
  const r = await runBootstrap({ invite: "garbage", steps: { meshJoin: async () => { ran = true; return ""; }, ensureRpc: async () => "", applyWithInvite: async () => "", offer: async () => 0 } });
  assert.equal(r.ok, false);
  assert.equal(ran, false);
});
