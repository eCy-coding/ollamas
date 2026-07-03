import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost, rpcServerArgs, shardServerArgs, planShardGroup, detectShardCapability } from "./shard.ts";

test("isPrivateHost: loopback/RFC1918/CGNAT/mesh yes, public no (RISK-K1)", () => {
  for (const h of ["127.0.0.1", "localhost", "10.1.2.3", "192.168.1.50", "172.16.0.9", "100.64.0.7", "fd7a::1", "::1"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ["8.8.8.8", "104.16.1.1", "example.com", "0.0.0.0"]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test("rpcServerArgs refuses public bind, builds private bind args", () => {
  assert.deepEqual(rpcServerArgs({ host: "127.0.0.1", port: 50052 }), ["--host", "127.0.0.1", "--port", "50052"]);
  assert.throws(() => rpcServerArgs({ host: "0.0.0.0", port: 50052 }), /private/i);
  assert.throws(() => rpcServerArgs({ host: "127.0.0.1", port: 99999 }), /port/i);
});

test("shardServerArgs builds llama-server --rpc endpoint list; private-only endpoints", () => {
  const args = shardServerArgs({
    modelPath: "/models/big.gguf",
    endpoints: [{ host: "100.64.0.7", port: 50052 }, { host: "100.64.0.8", port: 50052 }],
    port: 8085,
  });
  assert.deepEqual(args, [
    "--model", "/models/big.gguf",
    "--rpc", "100.64.0.7:50052,100.64.0.8:50052",
    "--host", "127.0.0.1",
    "--port", "8085",
  ]);
  assert.throws(
    () => shardServerArgs({ modelPath: "/m.gguf", endpoints: [{ host: "8.8.8.8", port: 50052 }], port: 8085 }),
    /private/i,
  );
  assert.throws(() => shardServerArgs({ modelPath: "/m.gguf", endpoints: [], port: 8085 }), /endpoint/i);
});

test("planShardGroup: partitions layers over rpc-capable fresh nodes", () => {
  const plan = planShardGroup(
    32,
    [
      { memberId: "m_a", url: "http://100.64.0.7:11434", ramGB: 48, rpcPort: 50052 },
      { memberId: "m_b", url: "http://100.64.0.8:11434", ramGB: 16, rpcPort: 50052 },
      { memberId: "m_norpc", url: "http://100.64.0.9:11434", ramGB: 64 }, // no rpcPort → excluded
    ],
  );
  assert.deepEqual(plan.endpoints, [
    { host: "100.64.0.7", port: 50052 },
    { host: "100.64.0.8", port: 50052 },
  ]);
  assert.equal(plan.slices.length, 2);
  assert.equal(plan.slices[0]?.endLayer, 24); // 48/64 of 32
  assert.throws(() => planShardGroup(32, [{ memberId: "m", url: "http://10.0.0.1:11434", ramGB: 8 }]), /rpc/i);
});

test("detectShardCapability: honest gate with brew hint when binaries missing", () => {
  const capable = detectShardCapability({ "llama-server": true, "rpc-server": true, rpcFlag: true });
  assert.equal(capable.capable, true);
  const missing = detectShardCapability({ "llama-server": true, "rpc-server": false, rpcFlag: false });
  assert.equal(missing.capable, false);
  assert.ok(missing.missing.includes("rpc-server"));
  assert.match(missing.hint, /GGML_RPC/);
});
