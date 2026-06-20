import test from "node:test";
import assert from "node:assert/strict";
import { TunnelSwitch } from "./switch.ts";
import { PRIORITY, type Transport, type TunnelEndpoint } from "./transport.ts";
import { autoUp, detectCapable, runLoop } from "./autopilot.ts";

/** Fake transport with controllable health + an up() spy. */
function fake(name: string, priority: number, opts: { healthy?: boolean } = {}): Transport & {
  ups: number;
  setHealthy: (h: boolean) => void;
} {
  let healthy = opts.healthy ?? false;
  let ups = 0;
  const t = {
    name,
    priority,
    up: async () => {
      ups += 1;
      healthy = true; // bringing it up makes it reachable
    },
    down: async () => {},
    probe: async () => healthy,
    endpoint: (): TunnelEndpoint => ({ url: `http://${name}`, transport: name, healthy }),
    get ups() {
      return ups;
    },
    setHealthy: (h: boolean) => {
      healthy = h;
    },
  };
  return t as Transport & { ups: number; setHealthy: (h: boolean) => void };
}

test("detectCapable filters by injected check and sorts by priority", async () => {
  const ts = [fake("mesh", PRIORITY.MESH), fake("lan", PRIORITY.LAN_TLS), fake("reverse", PRIORITY.REVERSE)];
  const capable = await detectCapable(ts, (t) => t.name !== "reverse");
  assert.deepEqual(
    capable.map((t) => t.name),
    ["lan", "mesh"],
  );
});

test("autoUp uses an already-healthy transport without bringing anything up", async () => {
  const lan = fake("lan", PRIORITY.LAN_TLS, { healthy: true });
  const sw = new TunnelSwitch({ now: () => 0 }).register(lan);
  const r = await autoUp(sw, [lan], { isCapable: () => true });
  assert.equal(r.endpoint?.transport, "lan");
  assert.equal(r.broughtUp, null);
  assert.equal(lan.ups, 0);
});

test("autoUp brings up the best capable transport when none is healthy", async () => {
  const lan = fake("lan", PRIORITY.LAN_TLS, { healthy: false });
  const mesh = fake("mesh", PRIORITY.MESH, { healthy: false });
  const sw = new TunnelSwitch({ now: () => 0 }).register(lan).register(mesh);
  const r = await autoUp(sw, [lan, mesh], { isCapable: () => true });
  assert.equal(r.broughtUp, "lan"); // best priority capable
  assert.equal(lan.ups, 1);
  assert.equal(r.endpoint?.transport, "lan"); // healthy after up()
});

test("autoUp reports no capable transport (zero manual, graceful)", async () => {
  const lan = fake("lan", PRIORITY.LAN_TLS, { healthy: false });
  const sw = new TunnelSwitch({ now: () => 0 }).register(lan);
  const r = await autoUp(sw, [lan], { isCapable: () => false });
  assert.equal(r.endpoint, null);
  assert.equal(r.broughtUp, null);
  assert.match(r.reason, /no capable transport/);
});

test("autoUp dry-run does not call up()", async () => {
  const lan = fake("lan", PRIORITY.LAN_TLS, { healthy: false });
  const sw = new TunnelSwitch({ now: () => 0 }).register(lan);
  const r = await autoUp(sw, [lan], { isCapable: () => true, bringUp: false });
  assert.equal(lan.ups, 0);
  assert.equal(r.broughtUp, null);
});

test("runLoop self-heals: brings the transport back up after it drops", async () => {
  const lan = fake("lan", PRIORITY.LAN_TLS, { healthy: true });
  const sw = new TunnelSwitch({ now: () => 0 }).register(lan);
  let round = 0;
  const results = await runLoop(sw, [lan], {
    isCapable: () => true,
    rounds: 3,
    sleep: async () => {
      // simulate the link dropping before round 1
      if (round === 0) lan.setHealthy(false);
      round += 1;
    },
  });
  assert.equal(results.length, 3);
  assert.equal(results[0]?.reason.includes("already healthy"), true);
  assert.equal(results[1]?.broughtUp, "lan"); // dropped → autopilot re-up
  assert.equal(results[2]?.reason.includes("already healthy"), true); // healed
});
