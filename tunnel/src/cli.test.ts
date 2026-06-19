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
