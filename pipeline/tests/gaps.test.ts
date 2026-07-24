import { describe, it, expect } from "vitest";
import { SEED_GAPS, gap, gapKey, severityFor, pendingGaps, mergeGaps, renderGapsMd, type Gap } from "../lib/gaps";

describe("severityFor — derived, not fabricated", () => {
  it("maps required docs features to high, structural to med, rest to low", () => {
    expect(severityFor("quickstart")).toBe("high");
    expect(severityFor("search")).toBe("high");
    expect(severityFor("api-reference")).toBe("med");
    expect(severityFor("theme-responsive")).toBe("low");
  });

  it("is stable — the same area always yields the same severity", () => {
    expect(severityFor("cli-reference")).toBe(severityFor("cli-reference"));
  });
});

describe("gap + SEED_GAPS", () => {
  it("gap() derives severity from the area, never hand-set", () => {
    const g = gap("ollamas", "quickstart", "kanıt");
    expect(g.severity).toBe("high");
    expect(g.plannedBy).toBeUndefined();
  });

  it("seeds gaps only for ollamas / eCym / obsidian, each with evidence", () => {
    expect(SEED_GAPS.length).toBeGreaterThanOrEqual(10);
    for (const g of SEED_GAPS) {
      expect(["ollamas", "ecym", "obsidian"]).toContain(g.system);
      expect(g.evidence.length).toBeGreaterThan(20); // source-tagged, not a stub
      expect(g.severity).toBe(severityFor(g.area)); // severity consistent with derivation
    }
  });

  it("has no duplicate (system, area) keys", () => {
    const keys = SEED_GAPS.map(gapKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("pendingGaps + mergeGaps", () => {
  it("pendingGaps returns only untaken gaps", () => {
    const taken: Gap = { ...SEED_GAPS[0], plannedBy: "planner-1", plan: "quickstart sayfası ekle" };
    const set = [taken, SEED_GAPS[1]];
    expect(pendingGaps(set)).toEqual([SEED_GAPS[1]]);
  });

  it("mergeGaps updates a gap in place by key and appends new ones", () => {
    const planned: Gap = { ...SEED_GAPS[0], plannedBy: "planner-2", plan: "adım adım" };
    const fresh = gap("ollamas", "mcp-reference", "yeni bulunan eksik");
    const merged = mergeGaps(SEED_GAPS, [planned, fresh]);
    expect(merged).toHaveLength(SEED_GAPS.length + 1); // one updated, one appended
    expect(merged.find((g) => gapKey(g) === gapKey(planned))!.plannedBy).toBe("planner-2");
    expect(merged.at(-1)!.area).toBe("mcp-reference");
  });
});

describe("renderGapsMd", () => {
  it("counts pending/planned and lists every gap with its evidence", () => {
    const md = renderGapsMd([{ ...SEED_GAPS[0], plannedBy: "planner-1", plan: "yap" }, SEED_GAPS[1]]);
    expect(md).toMatch(/bekleyen:\*\* 1/);
    expect(md).toMatch(/planlanan:\*\* 1/);
    expect(md).toContain("planner-1");
    for (const g of [SEED_GAPS[0], SEED_GAPS[1]]) expect(md).toContain(g.area);
  });
});
