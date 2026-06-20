import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TLS_PLAN,
  detectLocalHostname,
  renderCaddyfile,
  tlsServiceUrl,
  CaddyTlsTransport,
  type CaddyTlsPlan,
} from "./caddy-tls.ts";
import { PRIORITY } from "../transport.ts";

const plan: CaddyTlsPlan = { ...DEFAULT_TLS_PLAN, host: "emre-mbp.local" };

test("detectLocalHostname appends .local to scutil output", () => {
  assert.equal(detectLocalHostname(() => "emre-mbp\n"), "emre-mbp.local");
});

test("detectLocalHostname falls back to localhost on error", () => {
  assert.equal(
    detectLocalHostname(() => {
      throw new Error("not macos");
    }),
    "localhost",
  );
});

test("detectLocalHostname falls back to localhost on empty output", () => {
  assert.equal(detectLocalHostname(() => "  \n"), "localhost");
});

test("renderCaddyfile reverse-proxies host to upstream over TLS", () => {
  const c = renderCaddyfile(plan);
  assert.match(c, /^emre-mbp\.local \{/m);
  assert.match(c, /reverse_proxy localhost:3000/);
  assert.match(c, /tls keys\/cert\.pem keys\/key\.pem/);
});

test("tlsServiceUrl is https + host (no port)", () => {
  assert.equal(tlsServiceUrl(plan), "https://emre-mbp.local");
});

test("transport: name + LAN_TLS priority (highest)", () => {
  const t = new CaddyTlsTransport(plan);
  assert.equal(t.name, "caddy-tls");
  assert.equal(t.priority, PRIORITY.LAN_TLS);
  assert.equal(t.priority < PRIORITY.MESH, true); // wins over WireGuard
  assert.equal(t.endpoint().url, "https://emre-mbp.local");
  assert.equal(t.endpoint().healthy, false);
});
