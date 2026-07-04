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

// ---------- NamedCloudflareTransport ----------
import { EventEmitter } from "node:events";
import { NamedCloudflareTransport } from "./cloudflared-named.ts";
import { PRIORITY } from "../transport.ts";

interface FakeChild extends EventEmitter {
  stderr: EventEmitter;
  stdout: EventEmitter;
  killed: string | null;
  kill(sig?: string): void;
}
function makeFakeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stderr = new EventEmitter();
  c.stdout = new EventEmitter();
  c.killed = null;
  c.kill = (sig = "SIGTERM") => {
    c.killed = sig;
    c.emit("close", 0);
  };
  return c;
}

function make(over: {
  mode?: "token" | "cli";
  hasActiveKey?: () => boolean;
  gatewayHealthy?: () => Promise<boolean>;
  probeFn?: (b: string, p: string) => Promise<boolean>;
} = {}): { t: NamedCloudflareTransport; spawned: { cmd: string; args: string[] }[]; child: FakeChild } {
  const spawned: { cmd: string; args: string[] }[] = [];
  const child = makeFakeChild();
  const t = new NamedCloudflareTransport({
    hostname: "ollamas.example.dev",
    mode: over.mode ?? "token",
    token: "eyJhbG.SECRET",
    tunnelName: "ollamas",
    hasActiveKey: over.hasActiveKey ?? (() => true),
    gatewayHealthy: over.gatewayHealthy,
    spawnFn: (cmd, args) => {
      spawned.push({ cmd, args });
      return child;
    },
    probeFn: over.probeFn ?? (async () => true),
  });
  return { t, spawned, child };
}

test("named-transport: name + priority (REVERSE-1=29, preferred over quick)", () => {
  const { t } = make();
  assert.equal(t.name, "cloudflare-named");
  assert.equal(t.priority, PRIORITY.REVERSE - 1);
});

test("named-transport: endpoint URL is the STABLE hostname (no parse)", () => {
  const { t } = make();
  assert.equal(t.endpoint().url, "https://ollamas.example.dev");
  assert.equal(t.endpoint().transport, "cloudflare-named");
});

test("named-transport: token mode spawns `tunnel run --token`", async () => {
  const { t, spawned } = make({ mode: "token" });
  await t.up();
  assert.deepEqual(spawned, [{ cmd: "cloudflared", args: ["tunnel", "run", "--token", "eyJhbG.SECRET"] }]);
});

test("named-transport: cli mode spawns `tunnel run <name>`", async () => {
  const { t, spawned } = make({ mode: "cli" });
  await t.up();
  assert.deepEqual(spawned, [{ cmd: "cloudflared", args: ["tunnel", "run", "ollamas"] }]);
});

test("named-transport: up() refuses without active pxy_ key (RISK-TUNNEL-024)", async () => {
  const { t, spawned } = make({ hasActiveKey: () => false });
  await assert.rejects(() => t.up(), /RISK-TUNNEL-024/);
  assert.equal(spawned.length, 0);
});

test("named-transport: up() refuses on dead gateway", async () => {
  const { t, spawned } = make({ gatewayHealthy: async () => false });
  await assert.rejects(() => t.up(), /dead gateway|not answering/);
  assert.equal(spawned.length, 0);
});

test("named-transport: probe hits stable hostname + HEALTH_PATH", async () => {
  const calls: string[] = [];
  const { t } = make({ probeFn: async (b, p) => (calls.push(`${b}${p}`), true) });
  assert.equal(await t.probe(), true);
  assert.deepEqual(calls, ["https://ollamas.example.dev/api/health"]);
  assert.equal(t.endpoint().healthy, true);
});

test("named-transport: down() kills child, idempotent", async () => {
  const { t, child } = make();
  await t.up();
  await t.down();
  assert.equal(child.killed, "SIGTERM");
  await t.down(); // no throw
});
