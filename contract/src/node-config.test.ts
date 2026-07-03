import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNodeConfig, saveNodeConfig, defaultNodeConfigPath, resolveServerUrl, DEFAULT_NODE_CONFIG } from "./node-config.ts";

function tmpCfg(): string {
  return join(mkdtempSync(join(tmpdir(), "nodecfg-")), "sub", "contract-node.json");
}

test("missing file → defaults, no warning", () => {
  const { config, warning } = loadNodeConfig(tmpCfg());
  assert.deepEqual(config, DEFAULT_NODE_CONFIG);
  assert.equal(warning, undefined);
});

test("save/load roundtrip; file mode 0600; no tmp residue", () => {
  const p = tmpCfg();
  saveNodeConfig({ meshHost: "100.64.0.7", rpcPort: 50055, device: "MTL0", role: "member", model: "qwen3:4b" }, p);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  const { config } = loadNodeConfig(p);
  assert.equal(config.meshHost, "100.64.0.7");
  assert.equal(config.rpcPort, 50055);
  assert.equal(config.role, "member");
  assert.equal(config.model, "qwen3:4b");
});

test("corrupt file → defaults WITH warning", () => {
  const p = tmpCfg();
  saveNodeConfig(DEFAULT_NODE_CONFIG, p);
  writeFileSync(p, "{bad json");
  const { config, warning } = loadNodeConfig(p);
  assert.deepEqual(config, DEFAULT_NODE_CONFIG);
  assert.ok(warning && /corrupt/i.test(warning));
});

test("missing rpcPort in stored file → filled from default", () => {
  const p = tmpCfg();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ role: "operator" }));
  const { config } = loadNodeConfig(p);
  assert.equal(config.rpcPort, DEFAULT_NODE_CONFIG.rpcPort);
  assert.equal(config.role, "operator");
});

test("defaultNodeConfigPath lives under ~/.ollamas", () => {
  assert.ok(defaultNodeConfigPath().endsWith("/.ollamas/contract-node.json"));
});

test("operator config roundtrip (serverUrl/headLayers) (G6)", () => {
  const p = tmpCfg();
  saveNodeConfig({ rpcPort: 50052, role: "operator", serverUrl: "http://127.0.0.1:3210", headLayers: 40 }, p);
  const { config } = loadNodeConfig(p);
  assert.equal(config.role, "operator");
  assert.equal(config.serverUrl, "http://127.0.0.1:3210");
  assert.equal(config.headLayers, 40);
});

test("resolveServerUrl precedence: env > config > loopback default (G6)", () => {
  const prev = process.env.OLLAMAS_URL;
  delete process.env.OLLAMAS_URL;
  try {
    assert.equal(resolveServerUrl(() => ({ config: { ...DEFAULT_NODE_CONFIG, serverUrl: "http://cfg:3000" } })), "http://cfg:3000");
    assert.equal(resolveServerUrl(() => ({ config: { ...DEFAULT_NODE_CONFIG } })), "http://127.0.0.1:3000");
    process.env.OLLAMAS_URL = "http://env:9999";
    assert.equal(resolveServerUrl(() => ({ config: { ...DEFAULT_NODE_CONFIG, serverUrl: "http://cfg:3000" } })), "http://env:9999");
  } finally {
    if (prev === undefined) delete process.env.OLLAMAS_URL;
    else process.env.OLLAMAS_URL = prev;
  }
});
