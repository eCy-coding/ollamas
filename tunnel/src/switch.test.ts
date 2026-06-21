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

// ---- vT4: selectAuto (scoring + breaker + hysteresis + decision-log) ----

/** Deterministic timed-probe: latency per transport name; health from the fake itself. */
function probeWith(latency: Record<string, number>) {
  return async (t: Transport) => ({ ok: await t.probe(), ms: latency[t.name] ?? 5 });
}

test("selectAuto picks lowest measured latency (not just priority)", async () => {
  // lan has better priority but is slow; mesh is fast → mesh wins on score.
  const sw = new TunnelSwitch()
    .register(fake("lan", PRIORITY.LAN_TLS, true))
    .register(fake("mesh", PRIORITY.MESH, true));
  const ep = await sw.selectAuto({ timeProbe: probeWith({ lan: 500, mesh: 10 }) });
  assert.equal(ep?.transport, "mesh");
});

test("selectAuto records a decision-log entry with scores + reason", async () => {
  const sw = new TunnelSwitch({ now: () => 1234 })
    .register(fake("lan", PRIORITY.LAN_TLS, true))
    .register(fake("mesh", PRIORITY.MESH, true));
  await sw.selectAuto({ timeProbe: probeWith({ lan: 10, mesh: 30 }) });
  const d = sw.lastDecision();
  assert.equal(d?.ts, 1234);
  assert.equal(d?.winner, "lan");
  assert.equal(d?.scores.length, 2);
  assert.match(d?.reason ?? "", /lan/);
});

test("selectAuto opens a breaker after repeated failures and skips it", async () => {
  const sw = new TunnelSwitch({ breaker: { failureThreshold: 3, cooldownMs: 10_000 }, now: () => 0 })
    .register(fake("lan", PRIORITY.LAN_TLS, false)) // always unhealthy
    .register(fake("mesh", PRIORITY.MESH, true));
  const probe = probeWith({ lan: 5, mesh: 5 });
  for (let i = 0; i < 3; i++) await sw.selectAuto({ timeProbe: probe });
  const d = sw.lastDecision();
  const lan = d?.scores.find((s) => s.name === "lan");
  assert.equal(lan?.breaker, "open"); // tripped after 3 failures
  assert.equal(d?.winner, "mesh"); // healthy one still chosen
});

test("selectAuto returns null + no throw when nothing healthy", async () => {
  const sw = new TunnelSwitch()
    .register(fake("lan", PRIORITY.LAN_TLS, false))
    .register(fake("mesh", PRIORITY.MESH, false));
  assert.equal(await sw.selectAuto({ timeProbe: probeWith({}) }), null);
  assert.equal(sw.lastDecision()?.winner, null);
});

test("selectAuto hysteresis holds active until challenger persists", async () => {
  const sw = new TunnelSwitch({ hysteresis: { margin: 50, holdRounds: 2 }, now: () => 0 })
    .register(fake("lan", PRIORITY.LAN_TLS, true))
    .register(fake("mesh", PRIORITY.MESH, true));
  // round 0: both ~equal → lan (better priority on tie via score) becomes active
  await sw.selectAuto({ timeProbe: probeWith({ lan: 30, mesh: 30 }) });
  assert.equal(sw.activeName(), "lan");
  // now mesh becomes much faster; round 1 holds (streak 1), round 2 takes over
  const fastMesh = probeWith({ lan: 400, mesh: 10 });
  await sw.selectAuto({ timeProbe: fastMesh });
  assert.equal(sw.activeName(), "lan"); // hysteresis holds
  await sw.selectAuto({ timeProbe: fastMesh });
  assert.equal(sw.activeName(), "mesh"); // takeover after holdRounds
});
