// vT14: gateway-state — persist the live gateway status + ephemeral public URL (secret-free).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderGatewayState,
  readGatewayState,
  writeGatewayState,
  type GatewayState,
} from "./gateway-state.ts";

const sample: GatewayState = {
  running: true,
  publicUrl: "https://brave-lynx-oslo.trycloudflare.com",
  ts: 1_780_000_000_000,
};

test("gateway-state: write→read roundtrip via injected IO", () => {
  let stored = "";
  writeGatewayState("/x/state.json", sample, (_p, data) => {
    stored = data;
  });
  const back = readGatewayState("/x/state.json", () => stored);
  assert.deepEqual(back, sample);
});

test("gateway-state: missing/corrupt file → null (graceful, keystore N-013 pattern)", () => {
  assert.equal(
    readGatewayState("/x/none.json", () => {
      throw new Error("ENOENT");
    }),
    null,
  );
  assert.equal(readGatewayState("/x/bad.json", () => "{not json"), null);
});

test("gateway-state: renderGatewayState is human-readable + shows URL", () => {
  const out = renderGatewayState(sample);
  assert.match(out, /running/);
  assert.match(out, /brave-lynx-oslo\.trycloudflare\.com/);
});

test("gateway-state: serialized form carries NO secret (no pxy_ key)", () => {
  let stored = "";
  writeGatewayState("/x/state.json", sample, (_p, data) => {
    stored = data;
  });
  assert.ok(!stored.includes("pxy_"));
});

test("gateway-state: publicUrl null when down", () => {
  const down: GatewayState = { running: false, publicUrl: null, ts: 1 };
  let stored = "";
  writeGatewayState("/x/s.json", down, (_p, d) => (stored = d));
  assert.deepEqual(readGatewayState("/x/s.json", () => stored), down);
  assert.match(renderGatewayState(down), /DOWN|down|false/);
});
