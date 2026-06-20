import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLAN,
  renderServerConfig,
  renderPeerConfig,
  serviceUrl,
  WireGuardTransport,
  type WgPlan,
} from "./wireguard.ts";
import { PRIORITY } from "../transport.ts";

const plan: WgPlan = { ...DEFAULT_PLAN, endpointHost: "192.168.1.42" };

test("server config has Interface + Peer with peer pubkey and /32", () => {
  const c = renderServerConfig(plan, "SRV_PRIV", "PHONE_PUB");
  assert.match(c, /\[Interface\]/);
  assert.match(c, /PrivateKey = SRV_PRIV/);
  assert.match(c, /Address = 10\.7\.0\.1\/24/);
  assert.match(c, /ListenPort = 51820/);
  assert.match(c, /PublicKey = PHONE_PUB/);
  assert.match(c, /AllowedIPs = 10\.7\.0\.2\/32/);
});

test("peer config is split-tunnel: AllowedIPs only the server /32", () => {
  const c = renderPeerConfig(plan, "PHONE_PRIV", "SRV_PUB");
  assert.match(c, /Address = 10\.7\.0\.2\/32/);
  assert.match(c, /Endpoint = 192\.168\.1\.42:51820/);
  assert.match(c, /AllowedIPs = 10\.7\.0\.1\/32/);
  assert.match(c, /PersistentKeepalive = 25/);
  // must NOT route all traffic (no 0.0.0.0/0) — keeps phone LAN/internet intact
  assert.doesNotMatch(c, /0\.0\.0\.0\/0/);
});

test("serviceUrl points at server WG ip + service port", () => {
  assert.equal(serviceUrl(plan), "http://10.7.0.1:3000");
});

test("transport metadata: name + mesh priority", () => {
  const t = new WireGuardTransport(plan);
  assert.equal(t.name, "wireguard");
  assert.equal(t.priority, PRIORITY.MESH);
  assert.equal(t.endpoint().url, "http://10.7.0.1:3000");
  assert.equal(t.endpoint().healthy, false); // before any probe
});

test("private key never appears in peer config when not provided to render", () => {
  // server private key must not leak into the phone-facing config
  const c = renderPeerConfig(plan, "PHONE_PRIV", "SRV_PUB");
  assert.doesNotMatch(c, /SRV_PRIV/);
});
