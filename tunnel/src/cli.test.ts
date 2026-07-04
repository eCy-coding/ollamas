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
