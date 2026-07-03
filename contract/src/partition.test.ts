import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionLayers, fitsModel } from "./partition.ts";

test("splits proportionally to RAM (exo memory-weighted principle)", () => {
  const slices = partitionLayers(32, [
    { id: "a", ramGB: 48 },
    { id: "b", ramGB: 16 },
  ]);
  // 48/64=0.75 → 24 layers; 16/64=0.25 → 8 layers
  assert.deepEqual(slices, [
    { id: "a", startLayer: 0, endLayer: 24 },
    { id: "b", startLayer: 24, endLayer: 32 },
  ]);
});

test("slice sizes always sum to totalLayers; deviation ≤1 from exact share (property)", () => {
  const cases: Array<{ layers: number; rams: number[] }> = [
    { layers: 32, rams: [48, 16] },
    { layers: 33, rams: [10, 10, 10] },
    { layers: 80, rams: [64, 48, 24, 8] },
    { layers: 7, rams: [1, 1, 1, 1, 1] },
    { layers: 61, rams: [52, 9] },
    { layers: 1, rams: [8, 8] },
  ];
  for (const c of cases) {
    const nodes = c.rams.map((r, i) => ({ id: `n${i}`, ramGB: r }));
    const slices = partitionLayers(c.layers, nodes);
    const total = c.rams.reduce((a, b) => a + b, 0);
    const sum = slices.reduce((a, s) => a + (s.endLayer - s.startLayer), 0);
    assert.equal(sum, c.layers, `sum for ${JSON.stringify(c)}`);
    for (const s of slices) {
      const node = nodes.find((n) => n.id === s.id)!;
      const exact = (c.layers * node.ramGB) / total;
      const got = s.endLayer - s.startLayer;
      assert.ok(Math.abs(got - exact) <= 1, `deviation>1: ${s.id} got=${got} exact=${exact.toFixed(2)} in ${JSON.stringify(c)}`);
      assert.ok(got >= 0);
    }
    // contiguous, ordered, non-overlapping
    let cursor = 0;
    for (const s of slices) {
      assert.equal(s.startLayer, cursor);
      cursor = s.endLayer;
    }
    assert.equal(cursor, c.layers);
  }
});

test("filters zero/negative RAM nodes; rejects empty/invalid input", () => {
  const slices = partitionLayers(10, [
    { id: "a", ramGB: 16 },
    { id: "dead", ramGB: 0 },
  ]);
  assert.deepEqual(slices.map((s) => s.id), ["a"]);
  assert.throws(() => partitionLayers(10, []), /node/i);
  assert.throws(() => partitionLayers(0, [{ id: "a", ramGB: 8 }]), /layers/i);
});

test("fitsModel: VRAM-fit guard with overhead factor", () => {
  // 20GB model × 1.2 overhead = 24GB needed
  assert.equal(fitsModel(20, [{ id: "a", ramGB: 16 }, { id: "b", ramGB: 16 }]), true); // 32 ≥ 24
  assert.equal(fitsModel(20, [{ id: "a", ramGB: 8 }, { id: "b", ramGB: 8 }]), false); // 16 < 24
  assert.equal(fitsModel(0, [{ id: "a", ramGB: 1 }]), true);
});
