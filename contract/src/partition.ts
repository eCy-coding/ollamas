// PURE memory-weighted layer partitioning — exo principle (Apache-2.0, idea-only):
// each node hosts a contiguous layer slice proportional to its RAM share.
// Largest-remainder apportionment keeps every node within 1 layer of its exact
// share while slice sizes always sum to totalLayers.

export type PartitionNode = { id: string; ramGB: number };
export type Slice = { id: string; startLayer: number; endLayer: number }; // [start, end)

export function partitionLayers(totalLayers: number, nodesIn: PartitionNode[]): Slice[] {
  if (!Number.isInteger(totalLayers) || totalLayers <= 0) throw new Error("totalLayers must be a positive integer");
  const nodes = nodesIn.filter((n) => Number.isFinite(n.ramGB) && n.ramGB > 0);
  if (nodes.length === 0) throw new Error("at least one node with RAM > 0 required");
  const totalRam = nodes.reduce((a, n) => a + n.ramGB, 0);

  const shares = nodes.map((n) => {
    const exact = (totalLayers * n.ramGB) / totalRam;
    return { id: n.id, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let assigned = shares.reduce((a, s) => a + s.floor, 0);
  // hand out the remaining layers to the largest fractional remainders
  const byRem = [...shares].sort((a, b) => b.rem - a.rem);
  for (let i = 0; assigned < totalLayers; i++, assigned++) {
    const target = byRem[i % byRem.length];
    if (target) target.floor += 1;
  }

  const slices: Slice[] = [];
  let cursor = 0;
  for (const s of shares) {
    slices.push({ id: s.id, startLayer: cursor, endLayer: cursor + s.floor });
    cursor += s.floor;
  }
  return slices;
}

/** VRAM-fit guard: pooled RAM must cover the model plus runtime overhead
 * (KV cache, activations, transport buffers). */
export const DEFAULT_OVERHEAD = 1.2;

export function fitsModel(modelSizeGB: number, nodes: PartitionNode[], overhead = DEFAULT_OVERHEAD): boolean {
  const totalRam = nodes.filter((n) => n.ramGB > 0).reduce((a, n) => a + n.ramGB, 0);
  return totalRam >= modelSizeGB * overhead;
}
