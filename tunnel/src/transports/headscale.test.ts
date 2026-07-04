import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MESH_PLAN,
  HeadscaleTransport,
  clientUpCommand,
  createUserCommand,
  preAuthKeyCommand,
  renderHeadscaleConfig,
  serviceUrl,
  type HeadscalePlan,
} from "./headscale.ts";
import { PRIORITY } from "../transport.ts";

const plan: HeadscalePlan = {
  serverUrl: "https://emre-mbp.local:8080",
  listenAddr: "0.0.0.0:8080",
  ipPrefix: "100.64.0.0/10",
  meshIp: "100.64.0.1",
  servicePort: 3000,
  user: "ollamas",
};

test("config carries self-hosted server_url + CGNAT prefix", () => {
  const c = renderHeadscaleConfig(plan);
  assert.match(c, /server_url: https:\/\/emre-mbp\.local:8080/);
  assert.match(c, /100\.64\.0\.0\/10/);
});

test("config enables embedded DERP — sovereign NAT traversal, no Tailscale SaaS", () => {
  const c = renderHeadscaleConfig(plan);
  assert.match(c, /derp:/);
  assert.match(c, /enabled: true/);
  assert.match(c, /stun_listen_addr/);
});

test("config uses sqlite (zero external dep)", () => {
  assert.match(renderHeadscaleConfig(plan), /type: sqlite/);
});

test("client up command targets OUR login-server (not Tailscale SaaS)", () => {
  const cmd = clientUpCommand(plan, "KEY123");
  assert.match(cmd, /--login-server https:\/\/emre-mbp\.local:8080/);
  assert.match(cmd, /--authkey KEY123/);
  assert.doesNotMatch(cmd, /tailscale\.com/);
});

test("client up command default does not leak a real key", () => {
  assert.match(clientUpCommand(plan), /<PREAUTH_KEY>/);
});

test("preauth key command is zero-account + reusable", () => {
  const cmd = preAuthKeyCommand(plan);
  assert.match(cmd, /preauthkeys create/);
  assert.match(cmd, /--user ollamas/);
  assert.match(cmd, /--reusable/);
});

test("create user command", () => {
  assert.equal(createUserCommand(plan), "headscale users create ollamas");
});

test("serviceUrl points at the mesh IP", () => {
  assert.equal(serviceUrl(plan), "http://100.64.0.1:3000");
});

test("transport metadata: name + mesh priority + endpoint (unprobed)", () => {
  const t = new HeadscaleTransport(plan);
  assert.equal(t.name, "headscale");
  assert.equal(t.priority, PRIORITY.MESH);
  assert.equal(t.endpoint().url, "http://100.64.0.1:3000");
  assert.equal(t.endpoint().healthy, false);
});

test("DEFAULT_MESH_PLAN has sane sovereign defaults", () => {
  assert.equal(DEFAULT_MESH_PLAN.user, "ollamas");
  assert.equal(DEFAULT_MESH_PLAN.servicePort, 3000);
  assert.match(DEFAULT_MESH_PLAN.ipPrefix, /^100\.64/);
});

// ---------- vT14: DNS root-cause — global nameservers (MagicDNS forwarding) ----------
test("config emits global nameservers so MagicDNS forwards *.trycloudflare.com (RISK-TUNNEL-027)", () => {
  const c = renderHeadscaleConfig(plan);
  assert.match(c, /nameservers:/);
  assert.match(c, /global:/);
  assert.match(c, /- 1\.1\.1\.1/);
  assert.match(c, /- 1\.0\.0\.1/);
});

test("config honors custom globalNameservers", () => {
  const c = renderHeadscaleConfig({ ...plan, globalNameservers: ["9.9.9.9"] });
  assert.match(c, /- 9\.9\.9\.9/);
  assert.ok(!c.includes("1.1.1.1"));
});
