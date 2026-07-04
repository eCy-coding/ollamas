// vT15: named cloudflare tunnel pure core — parsers + argv builders (both methods).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTunnelCreate,
  tokenRunArgs,
  namedRunArgs,
  createArgs,
  routeDnsArgs,
  loginArgs,
} from "./cloudflared-named.ts";

// ---------- parseTunnelCreate ----------

test("named: parseTunnelCreate extracts UUID + credentials path (real sample)", () => {
  const stdout = [
    "Tunnel credentials written to /Users/you/.cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json.",
    "Created tunnel ollamas with id 6ff42ae2-765d-4adf-8112-31c55c1551ef",
  ].join("\n");
  assert.deepEqual(parseTunnelCreate(stdout), {
    id: "6ff42ae2-765d-4adf-8112-31c55c1551ef",
    credFile: "/Users/you/.cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json",
  });
});

test("named: parseTunnelCreate handles order-independent lines", () => {
  const stdout =
    "Created tunnel x with id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n" +
    "Tunnel credentials written to /root/.cloudflared/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json.";
  assert.deepEqual(parseTunnelCreate(stdout), {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    credFile: "/root/.cloudflared/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json",
  });
});

test("named: parseTunnelCreate null when UUID or credfile missing", () => {
  assert.equal(parseTunnelCreate("nothing useful here"), null);
  assert.equal(parseTunnelCreate("Created tunnel x with id not-a-uuid"), null);
  assert.equal(parseTunnelCreate(""), null);
});

// ---------- argv builders ----------

test("named: tokenRunArgs pins run --token", () => {
  assert.deepEqual(tokenRunArgs("eyJhbGci"), ["tunnel", "run", "--token", "eyJhbGci"]);
});

test("named: namedRunArgs runs by name", () => {
  assert.deepEqual(namedRunArgs("ollamas"), ["tunnel", "run", "ollamas"]);
});

test("named: createArgs", () => {
  assert.deepEqual(createArgs("ollamas"), ["tunnel", "create", "ollamas"]);
});

test("named: routeDnsArgs binds name → hostname", () => {
  assert.deepEqual(routeDnsArgs("ollamas", "ollamas.example.dev"), [
    "tunnel",
    "route",
    "dns",
    "ollamas",
    "ollamas.example.dev",
  ]);
});

test("named: loginArgs", () => {
  assert.deepEqual(loginArgs(), ["tunnel", "login"]);
});
