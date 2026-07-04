// vT13: Cloudflare REVERSE transport — quick tunnel (no account) + named tunnel (optional).
// All exec injected (headscale pattern); NO real cloudflared needed for tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  parseQuickTunnelUrl,
  renderNamedConfig,
  quickTunnelArgs,
  CloudflareTransport,
  type SpawnFn,
} from "./cloudflare.ts";
import { PRIORITY } from "../transport.ts";

// ---------- pure: URL parsing ----------

test("cloudflare: parseQuickTunnelUrl extracts trycloudflare URL from banner line", () => {
  const line = "2026-07-04T12:00:00Z INF |  https://spicy-otter-tokyo-fjord.trycloudflare.com                                   |";
  assert.equal(parseQuickTunnelUrl(line), "https://spicy-otter-tokyo-fjord.trycloudflare.com");
});

test("cloudflare: parseQuickTunnelUrl handles plain INF registered line", () => {
  assert.equal(
    parseQuickTunnelUrl("INF Registered tunnel connection https://a1-b2.trycloudflare.com index=0"),
    "https://a1-b2.trycloudflare.com",
  );
});

test("cloudflare: parseQuickTunnelUrl null on unrelated lines", () => {
  assert.equal(parseQuickTunnelUrl("INF Starting metrics server on 127.0.0.1:20241/metrics"), null);
  assert.equal(parseQuickTunnelUrl("https://evil.example.com/x.trycloudflare.com.attacker.io"), null);
  assert.equal(parseQuickTunnelUrl(""), null);
});

// ---------- pure: named-tunnel config + args ----------

test("cloudflare: renderNamedConfig YAML shape (ingress + 404 fallback)", () => {
  const y = renderNamedConfig({
    tunnelId: "abcd-1234",
    credFile: "/Users/emre/.cloudflared/abcd-1234.json",
    hostname: "ollamas.example.com",
    localPort: 8443,
  });
  assert.match(y, /^tunnel: abcd-1234$/m);
  assert.match(y, /^credentials-file: \/Users\/emre\/\.cloudflared\/abcd-1234\.json$/m);
  assert.match(y, /hostname: ollamas\.example\.com/);
  assert.match(y, /service: http:\/\/127\.0\.0\.1:8443/);
  assert.match(y, /http_status:404/); // catch-all: anything not our hostname → 404
});

test("cloudflare: quickTunnelArgs pins loopback target + no-autoupdate", () => {
  assert.deepEqual(quickTunnelArgs(8443), [
    "tunnel",
    "--url",
    "http://127.0.0.1:8443",
    "--no-autoupdate",
  ]);
});

// ---------- transport: fake child plumbing ----------

interface FakeChild extends EventEmitter {
  stderr: EventEmitter;
  stdout: EventEmitter;
  killed: string | null;
  kill(sig?: string): void;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.killed = null;
  child.kill = (sig = "SIGTERM") => {
    child.killed = sig;
    child.emit("close", 0);
  };
  return child;
}

function makeTransport(overrides: {
  hasActiveKey?: () => boolean;
  spawnFn?: SpawnFn;
  probeFn?: (base: string, path: string) => Promise<boolean>;
  timeoutMs?: number;
} = {}): { t: CloudflareTransport; spawned: { cmd: string; args: string[] }[]; child: FakeChild } {
  const spawned: { cmd: string; args: string[] }[] = [];
  const child = makeFakeChild();
  const spawnFn: SpawnFn =
    overrides.spawnFn ??
    ((cmd, args) => {
      spawned.push({ cmd, args });
      return child;
    });
  const t = new CloudflareTransport({
    localPort: 8443,
    hasActiveKey: overrides.hasActiveKey ?? (() => true),
    spawnFn,
    probeFn: overrides.probeFn ?? (async () => true),
    timeoutMs: overrides.timeoutMs ?? 200,
  });
  return { t, spawned, child };
}

test("cloudflare: name/priority contract (REVERSE=30)", () => {
  const { t } = makeTransport();
  assert.equal(t.name, "cloudflare");
  assert.equal(t.priority, PRIORITY.REVERSE);
});

test("cloudflare: up() HARD-REFUSES without active pxy_ key (RISK-TUNNEL-024), no spawn", async () => {
  const { t, spawned } = makeTransport({ hasActiveKey: () => false });
  await assert.rejects(() => t.up(), /RISK-TUNNEL-024/);
  assert.equal(spawned.length, 0); // never exposed
});

test("cloudflare: up() spawns quick tunnel, resolves when URL appears on stderr", async () => {
  const { t, spawned, child } = makeTransport();
  const upP = t.up();
  queueMicrotask(() => {
    child.stderr.emit("data", Buffer.from("INF Starting tunnel\n"));
    child.stderr.emit(
      "data",
      Buffer.from("INF |  https://brave-lynx-oslo.trycloudflare.com  |\n"),
    );
  });
  await upP;
  assert.deepEqual(spawned, [{ cmd: "cloudflared", args: quickTunnelArgs(8443) }]);
  const ep = t.endpoint();
  assert.equal(ep.url, "https://brave-lynx-oslo.trycloudflare.com");
  assert.equal(ep.transport, "cloudflare");
});

test("cloudflare: up() idempotent — second call does not respawn", async () => {
  const { t, spawned, child } = makeTransport();
  const upP = t.up();
  queueMicrotask(() =>
    child.stderr.emit("data", Buffer.from("https://a.trycloudflare.com\n")),
  );
  await upP;
  await t.up();
  assert.equal(spawned.length, 1);
});

test("cloudflare: up() rejects with brew hint when binary missing (ENOENT)", async () => {
  const { t, child } = makeTransport();
  const upP = t.up();
  queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" })));
  await assert.rejects(() => upP, /brew install cloudflared/);
});

test("cloudflare: up() times out when no URL ever appears", async () => {
  const { t } = makeTransport({ timeoutMs: 30 });
  await assert.rejects(() => t.up(), /timed out/);
});

test("cloudflare: down() kills child + clears endpoint; idempotent", async () => {
  const { t, child } = makeTransport();
  const upP = t.up();
  queueMicrotask(() => child.stderr.emit("data", Buffer.from("https://b.trycloudflare.com\n")));
  await upP;
  await t.down();
  assert.equal(child.killed, "SIGTERM");
  assert.equal(t.endpoint().url, "");
  assert.equal(t.endpoint().healthy, false);
  await t.down(); // no throw
});

test("cloudflare: probe() hits publicUrl + HEALTH_PATH via injected probeFn", async () => {
  const calls: string[] = [];
  const { t, child } = makeTransport({
    probeFn: async (base, path) => {
      calls.push(`${base}${path}`);
      return true;
    },
  });
  const upP = t.up();
  queueMicrotask(() => child.stderr.emit("data", Buffer.from("https://c.trycloudflare.com\n")));
  await upP;
  assert.equal(await t.probe(), true);
  assert.deepEqual(calls, ["https://c.trycloudflare.com/api/health"]);
  assert.equal(t.endpoint().healthy, true);
});

test("cloudflare: probe() false when not up (no URL yet)", async () => {
  const { t } = makeTransport();
  assert.equal(await t.probe(), false);
});

// ---------- integration: switch/autopilot wiring ----------
import { TunnelSwitch } from "../switch.ts";
import { TRANSPORT_BINARY, detectCapable } from "../autopilot.ts";
import type { Transport } from "../transport.ts";

function fakeTransport(name: string, priority: number, healthy: boolean): Transport {
  return {
    name,
    priority,
    async up() {},
    async down() {},
    async probe() {
      return healthy;
    },
    endpoint() {
      return { url: `http://${name}`, transport: name, healthy };
    },
  };
}

test("cloudflare: TRANSPORT_BINARY maps cloudflare → cloudflared (autopilot capability)", () => {
  assert.equal(TRANSPORT_BINARY["cloudflare"], "cloudflared");
});

test("cloudflare: selectAuto falls back to REVERSE when nothing else is healthy", async () => {
  const { t, child } = makeTransport();
  const upP = t.up();
  queueMicrotask(() => child.stderr.emit("data", Buffer.from("https://d.trycloudflare.com\n")));
  await upP;
  const sw = new TunnelSwitch();
  sw.register(fakeTransport("caddy-tls", PRIORITY.LAN_TLS, false));
  sw.register(t);
  const ep = await sw.selectAuto();
  assert.equal(ep?.transport, "cloudflare");
});

test("cloudflare: selectAuto prefers healthy LAN_TLS(10) over healthy REVERSE(30)", async () => {
  const { t, child } = makeTransport();
  const upP = t.up();
  queueMicrotask(() => child.stderr.emit("data", Buffer.from("https://e.trycloudflare.com\n")));
  await upP;
  const sw = new TunnelSwitch();
  sw.register(fakeTransport("caddy-tls", PRIORITY.LAN_TLS, true));
  sw.register(t);
  const ep = await sw.selectAuto();
  assert.equal(ep?.transport, "caddy-tls");
});

test("cloudflare: detectCapable includes cloudflare when its binary exists (injected)", async () => {
  const { t } = makeTransport();
  const capable = await detectCapable([t, fakeTransport("caddy-tls", PRIORITY.LAN_TLS, true)], (tr) =>
    Promise.resolve(tr.name === "cloudflare"),
  );
  assert.deepEqual(capable.map((c) => c.name), ["cloudflare"]);
});
