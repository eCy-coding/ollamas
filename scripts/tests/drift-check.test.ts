// Scripts domain v10 — drift guard test. The real 4-source set must stay
// aligned (regression guard), and the pure detector must catch every drift
// class: missing schema, orphan tool file, missing builder, missing entry file.
import { describe, test, expect } from "vitest";
import { collectSources, detectDrift } from "../../bin/host-bridge/drift-check.mjs";

describe("host-tool drift guard", () => {
  test("real sources are aligned (inventory == schema == builders == files)", () => {
    const res = detectDrift(collectSources());
    expect(res.ok).toBe(true);
    expect(res.drifts).toEqual([]);
    expect(res.missingFiles).toEqual([]);
  });

  test("real inventory is non-trivial and tier-tagged via schema parity", () => {
    const src = collectSources();
    expect(src.inventory.length).toBeGreaterThanOrEqual(17);
    // every source set has the same cardinality when aligned
    expect(src.schema.length).toBe(src.inventory.length);
    expect(src.builders.length).toBe(src.inventory.length);
    expect(src.files.length).toBe(src.inventory.length);
  });

  test("detects a tool missing from schema", () => {
    const src = collectSources();
    const broken = { ...src, schema: src.schema.filter((n: string) => n !== src.inventory[0]) };
    const res = detectDrift(broken);
    expect(res.ok).toBe(false);
    const d = res.drifts.find((x: any) => x.pair === "inventory↔schema");
    expect(d.only_in_inventory).toContain(src.inventory[0]);
  });

  test("detects an orphan tool file with no manifest entry", () => {
    const src = collectSources();
    const broken = { ...src, files: [...src.files, "rogue_tool"] };
    const res = detectDrift(broken);
    expect(res.ok).toBe(false);
    const d = res.drifts.find((x: any) => x.pair === "inventory↔files");
    expect(d.only_in_files).toContain("rogue_tool");
  });

  test("detects a missing builder", () => {
    const src = collectSources();
    const broken = { ...src, builders: src.builders.slice(1) };
    const res = detectDrift(broken);
    expect(res.ok).toBe(false);
    expect(res.drifts.some((x: any) => x.pair === "inventory↔builders")).toBe(true);
  });

  test("detects a manifest entry whose file is missing on disk", () => {
    const src = collectSources();
    const broken = {
      ...src,
      inventoryEntries: [...src.inventoryEntries, { name: "ghost", entry: "ghost_does_not_exist.mjs" }],
    };
    const res = detectDrift(broken);
    expect(res.ok).toBe(false);
    expect(res.missingFiles.some((m: string) => m.includes("ghost"))).toBe(true);
  });
});
