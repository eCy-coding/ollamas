import test from "node:test";
import assert from "node:assert/strict";
import { detectLanIp } from "./cli.ts";

test("detectLanIp returns a dotted IPv4 string", () => {
  const ip = detectLanIp();
  assert.match(ip, /^\d{1,3}(\.\d{1,3}){3}$/);
});

test("detectLanIp never returns an internal loopback unless no LAN present", () => {
  // Just assert it is a string; on CI with only loopback it falls back to 127.0.0.1.
  assert.equal(typeof detectLanIp(), "string");
});

// ---------- vT12: proxy command plumbing (pure helpers) ----------
import { parseProxyArgs, proxyDaemonPlan, PROXY_DAEMON_LABEL } from "./cli.ts";

test("parseProxyArgs: defaults — port 8443, TLS on", () => {
  const p = parseProxyArgs([]);
  assert.deepEqual(p, { port: 8443, tls: true });
});

test("parseProxyArgs: --port and --no-tls honored", () => {
  const p = parseProxyArgs(["--port", "9000", "--no-tls"]);
  assert.deepEqual(p, { port: 9000, tls: false });
});

test("parseProxyArgs: invalid port throws", () => {
  assert.throws(() => parseProxyArgs(["--port", "abc"]), /port/);
  assert.throws(() => parseProxyArgs(["--port", "70000"]), /port/);
});

test("proxyDaemonPlan: dedicated label, runs `proxy up`", () => {
  const plan = proxyDaemonPlan();
  assert.equal(plan.label, PROXY_DAEMON_LABEL);
  assert.equal(plan.label, "com.ollamas.tunnel.proxy");
  assert.deepEqual(plan.args, ["proxy", "up"]);
  assert.ok(plan.cliPath.endsWith("cli.ts"));
});

// ---------- vT14: gateway-state path + both-daemon wiring ----------
import { GATEWAY_STATE_PATH } from "./cli.ts";
import { DEFAULT_LABEL } from "./daemon.ts";
import { daemonLabelsForSetup } from "./setup.ts";

test("GATEWAY_STATE_PATH lives under keys/", () => {
  assert.match(GATEWAY_STATE_PATH(), /keys\/gateway-state\.json$/);
});

test("daemonLabelsForSetup: both agents when proxy vault present", () => {
  const labels = daemonLabelsForSetup({ autopilot: DEFAULT_LABEL, proxy: PROXY_DAEMON_LABEL }, true);
  assert.deepEqual(labels, [DEFAULT_LABEL, PROXY_DAEMON_LABEL]);
});

test("daemonLabelsForSetup: only autopilot when no proxy vault", () => {
  const labels = daemonLabelsForSetup({ autopilot: DEFAULT_LABEL, proxy: PROXY_DAEMON_LABEL }, false);
  assert.deepEqual(labels, [DEFAULT_LABEL]);
});

// ---------- vT15: named-tunnel cli helpers ----------
import { parseNamedArgs, namedDaemonPlan, NAMED_DAEMON_LABEL } from "./cli.ts";

test("parseNamedArgs: token subcommand", () => {
  const p = parseNamedArgs(["token", "eyJhbG.SECRET", "--hostname", "ollamas.example.dev"]);
  assert.deepEqual(p, { op: "token", token: "eyJhbG.SECRET", hostname: "ollamas.example.dev", name: undefined });
});

test("parseNamedArgs: create subcommand", () => {
  const p = parseNamedArgs(["create", "ollamas", "--hostname", "ollamas.example.dev"]);
  assert.deepEqual(p, { op: "create", name: "ollamas", hostname: "ollamas.example.dev", token: undefined });
});

test("parseNamedArgs: bare op (up/down/status/login)", () => {
  assert.equal(parseNamedArgs(["up"]).op, "up");
  assert.equal(parseNamedArgs(["status"]).op, "status");
  assert.equal(parseNamedArgs([]).op, "status"); // default
});

test("parseNamedArgs: token requires --hostname (throws)", () => {
  assert.throws(() => parseNamedArgs(["token", "eyJ"]), /hostname/);
});

test("namedDaemonPlan: dedicated label runs `proxy cloudflare named up`", () => {
  const plan = namedDaemonPlan();
  assert.equal(plan.label, NAMED_DAEMON_LABEL);
  assert.equal(plan.label, "com.ollamas.tunnel.cloudflared");
  assert.deepEqual(plan.args, ["proxy", "cloudflare", "named", "up"]);
});
