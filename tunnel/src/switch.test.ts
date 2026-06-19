import test from "node:test";
import assert from "node:assert/strict";
import { TunnelSwitch } from "./switch.ts";
import { PRIORITY, type Transport, type TunnelEndpoint } from "./transport.ts";

function fake(name: string, priority: number, healthy: boolean): Transport {
  return {
    name,
    priority,
    up: async () => {},
    down: async () => {},
    probe: async () => healthy,
    endpoint: (): TunnelEndpoint => ({ url: `http://${name}`, transport: name, healthy }),
  };
}

test("empty registry → select returns null, no throw", async () => {
  const sw = new TunnelSwitch();
  assert.equal(await sw.select(), null);
  assert.equal(sw.current(), null);
});

test("picks highest-priority (lowest value) healthy transport", async () => {
  const sw = new TunnelSwitch()
    .register(fake("reverse", PRIORITY.REVERSE, true))
    .register(fake("lan", PRIORITY.LAN_TLS, true))
    .register(fake("mesh", PRIORITY.MESH, true));
  const ep = await sw.select();
  assert.equal(ep?.transport, "lan");
});

test("skips unhealthy, falls through to next priority", async () => {
  const sw = new TunnelSwitch()
    .register(fake("lan", PRIORITY.LAN_TLS, false))
    .register(fake("mesh", PRIORITY.MESH, false))
    .register(fake("reverse", PRIORITY.REVERSE, true));
  const ep = await sw.select();
  assert.equal(ep?.transport, "reverse");
});

test("all unhealthy → null and current() null", async () => {
  const sw = new TunnelSwitch()
    .register(fake("lan", PRIORITY.LAN_TLS, false))
    .register(fake("mesh", PRIORITY.MESH, false));
  assert.equal(await sw.select(), null);
  assert.equal(sw.current(), null);
});

test("current() reflects last successful select", async () => {
  const sw = new TunnelSwitch().register(fake("mesh", PRIORITY.MESH, true));
  await sw.select();
  assert.equal(sw.current()?.transport, "mesh");
});

test("ordered() sorts by priority without mutating registration order", async () => {
  const sw = new TunnelSwitch()
    .register(fake("reverse", PRIORITY.REVERSE, true))
    .register(fake("lan", PRIORITY.LAN_TLS, true));
  assert.deepEqual(
    sw.ordered().map((t) => t.name),
    ["lan", "reverse"],
  );
});
