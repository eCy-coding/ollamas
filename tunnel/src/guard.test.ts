import test from "node:test";
import assert from "node:assert/strict";
import { assertPrivateUrl, isPrivateHost } from "./guard.ts";

test("loopback + localhost are private", () => {
  assert.equal(isPrivateHost("localhost"), true);
  assert.equal(isPrivateHost("127.0.0.1"), true);
  assert.equal(isPrivateHost("::1"), true);
});

test("RFC1918 ranges are private", () => {
  assert.equal(isPrivateHost("10.7.0.1"), true); // WireGuard server
  assert.equal(isPrivateHost("192.168.1.42"), true);
  assert.equal(isPrivateHost("172.16.0.1"), true);
  assert.equal(isPrivateHost("172.31.255.255"), true);
  assert.equal(isPrivateHost("172.15.0.1"), false); // just outside 172.16/12
  assert.equal(isPrivateHost("172.32.0.1"), false);
});

test("CGNAT 100.64/10 (mesh) is private", () => {
  assert.equal(isPrivateHost("100.64.0.1"), true); // Headscale mesh IP
  assert.equal(isPrivateHost("100.127.255.255"), true);
  assert.equal(isPrivateHost("100.63.0.1"), false); // below range
  assert.equal(isPrivateHost("100.128.0.1"), false); // above range
});

test(".local (Bonjour) + link-local are private", () => {
  assert.equal(isPrivateHost("emre-mbp.local"), true);
  assert.equal(isPrivateHost("169.254.1.1"), true);
});

test("public hosts are refused", () => {
  assert.equal(isPrivateHost("8.8.8.8"), false);
  assert.equal(isPrivateHost("1.1.1.1"), false);
  assert.equal(isPrivateHost("example.com"), false);
  assert.equal(isPrivateHost("attacker.evil"), false);
  assert.equal(isPrivateHost(""), false);
});

test("malformed octets refused", () => {
  assert.equal(isPrivateHost("10.0.0.999"), false);
  assert.equal(isPrivateHost("999.1.1.1"), false);
});

test("assertPrivateUrl parses host then checks", () => {
  assert.equal(assertPrivateUrl("http://10.7.0.1:3000/healthz"), true);
  assert.equal(assertPrivateUrl("https://emre-mbp.local/healthz"), true);
  assert.equal(assertPrivateUrl("http://100.64.0.1:3000/healthz"), true);
  assert.equal(assertPrivateUrl("http://8.8.8.8:3000/healthz"), false);
  assert.equal(assertPrivateUrl("not-a-url"), false);
});
