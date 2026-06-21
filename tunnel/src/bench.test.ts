import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkTransports, percentile, renderBenchTable, summarize } from "./bench.ts";
import { PRIORITY, type Transport, type TunnelEndpoint } from "./transport.ts";

test("percentile nearest-rank on a known vector", () => {
  const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // sorted, n=10
  assert.equal(percentile(v, 50), 50); // ceil(0.5*10)=5 → v[4]=50
  assert.equal(percentile(v, 90), 90); // ceil(0.9*10)=9 → v[8]=90
  assert.equal(percentile(v, 100), 100);
  assert.equal(percentile(v, 0), 10); // clamps to first
  assert.equal(percentile([], 50), 0);
});

test("summarize empty → zeros, single, many", () => {
  assert.deepEqual(summarize([]), { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0 });
  const one = summarize([42]);
  assert.equal(one.count, 1);
  assert.equal(one.p50, 42);
  const many = summarize([30, 10, 20]); // unsorted input
  assert.equal(many.min, 10);
  assert.equal(many.max, 30);
  assert.equal(many.mean, 20);
});

test("summarize ignores non-finite", () => {
  const s = summarize([10, Infinity, 20]);
  assert.equal(s.count, 2);
});

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

test("benchmarkTransports collects p50/p90 + healthyRatio (injected timeProbe)", async () => {
  const lan = fake("lan", PRIORITY.LAN_TLS, true);
  const mesh = fake("mesh", PRIORITY.MESH, false);
  // deterministic latencies per transport name
  const lat: Record<string, number[]> = { lan: [10, 20, 30, 40, 50], mesh: [] };
  const idx: Record<string, number> = { lan: 0, mesh: 0 };
  const timeProbe = async (t: Transport) => {
    const ok = await t.probe();
    if (!ok) return { ok, ms: Infinity };
    const arr = lat[t.name] ?? [];
    const i = idx[t.name] ?? 0;
    idx[t.name] = i + 1;
    return { ok, ms: arr[i % (arr.length || 1)] ?? 5 };
  };
  const res = await benchmarkTransports([lan, mesh], { samples: 5, timeProbe });
  const lanR = res.find((r) => r.name === "lan");
  const meshR = res.find((r) => r.name === "mesh");
  assert.equal(lanR?.healthyRatio, 1);
  assert.equal(lanR?.summary.p50, 30); // ceil(.5*5)=3 → sorted[2]=30
  assert.equal(meshR?.healthyRatio, 0); // never healthy
  assert.equal(meshR?.summary.count, 0);
});

test("renderBenchTable: healthy first, p50-sorted; empty handled", () => {
  assert.match(renderBenchTable([]), /no transports/);
  const table = renderBenchTable([
    { name: "slow", priority: 10, healthyRatio: 1, summary: summarize([200, 200, 200]), samples: [200, 200, 200] },
    { name: "fast", priority: 20, healthyRatio: 1, summary: summarize([10, 10, 10]), samples: [10, 10, 10] },
    { name: "dead", priority: 30, healthyRatio: 0, summary: summarize([]), samples: [] },
  ]);
  const fastIdx = table.indexOf("fast");
  const slowIdx = table.indexOf("slow");
  const deadIdx = table.indexOf("dead");
  assert.ok(fastIdx < slowIdx); // lower p50 first
  assert.ok(slowIdx < deadIdx); // unhealthy last
});
