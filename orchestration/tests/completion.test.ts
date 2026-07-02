import { describe, it, expect } from "vitest";
import { streamFor, analyzeCompletion, renderCompletionReport, filterProxiedMissing, isRealMarkerLine, type CensusInput } from "../bin/lib/completion";

const census = (over: Partial<CensusInput> = {}): CensusInput => ({
  langs: [{ ext: "ts", count: 525 }, { ext: "mjs", count: 98 }, { ext: "sh", count: 23 }],
  mjsByDir: [{ dir: "scripts", count: 31 }, { dir: "bin/host-bridge/tools", count: 19 }],
  mjsTotal: 98,
  shCount: 23,
  stubFiles: [],
  sparseDirs: [],
  routeGap: { missing: [], unused: [] },
  centralTests: 144,
  ...over,
});

describe("streamFor — gap → owning fleet stream", () => {
  it("maps migration to mjs-migration and route-missing to typescript-core", () => {
    expect(streamFor("language-migration")).toBe("mjs-migration");
    expect(streamFor("route-missing")).toBe("typescript-core");
    expect(streamFor("route-unused")).toBe("errors-resilience");
  });
});

describe("analyzeCompletion — only provable gaps", () => {
  it("flags the .mjs migration gap as P1 when >50 files", () => {
    const g = analyzeCompletion(census()).find((x) => x.kind === "language-migration")!;
    expect(g.severity).toBe("P1");
    expect(g.ownerStream).toBe("mjs-migration");
    expect(g.evidence).toContain("98");
  });
  it("NEVER fabricates a test-coverage gap (tests are centralized)", () => {
    const gaps = analyzeCompletion(census({ centralTests: 144 }));
    expect(gaps.some((g) => /test|coverage/i.test(g.kind))).toBe(false);
  });
  it("emits a P1 route-missing and P3 route-unused from real drift", () => {
    const gaps = analyzeCompletion(census({ routeGap: { missing: ["/api/ghost"], unused: ["/api/legacy"] } }));
    const miss = gaps.find((g) => g.kind === "route-missing")!;
    const un = gaps.find((g) => g.kind === "route-unused")!;
    expect(miss.severity).toBe("P1");
    expect(un.severity).toBe("P3");
  });
  it("flags sparse folders as P3 SUSPECTED, and stub files as P2", () => {
    const gaps = analyzeCompletion(census({ sparseDirs: [{ dir: "client", count: 1 }], stubFiles: ["scripts/x.mjs"] }));
    expect(gaps.find((g) => g.kind === "sparse-folder")!.severity).toBe("P3");
    expect(gaps.find((g) => g.kind === "stub")!.severity).toBe("P2");
  });
  it("no .mjs → no migration gap", () => {
    expect(analyzeCompletion(census({ mjsTotal: 0, mjsByDir: [] })).some((g) => g.kind === "language-migration")).toBe(false);
  });
});

describe("filterProxiedMissing — proxy-served routes are not missing (vO46 precision)", () => {
  it("drops calls under an app.use proxy prefix, keeps genuine gaps", () => {
    const out = filterProxiedMissing(["/api/ecysearcher/status", "/api/ecysearcher", "/api/genuinely-absent"], ["/api/ecysearcher"]);
    expect(out).toEqual(["/api/genuinely-absent"]);
  });
  it("no prefixes → unchanged", () => {
    expect(filterProxiedMissing(["/api/x"], [])).toEqual(["/api/x"]);
  });
});

describe("isRealMarkerLine — real comment markers only, not string/regex mentions (vO46 precision)", () => {
  it("true for a real code comment marker", () => {
    expect(isRealMarkerLine("  // TODO: implement retry")).toBe(true);
    expect(isRealMarkerLine("# FIXME broken on macOS")).toBe(true);
  });
  it("false for the word inside a string literal (grep arg) or a detector regex", () => {
    expect(isRealMarkerLine('stubFiles = grep(["-e", "TODO", "-e", "FIXME"])')).toBe(false);
    expect(isRealMarkerLine("const count = str.match(/\\b(TODO|FIXME)\\b/g)")).toBe(false);
    expect(isRealMarkerLine("const x = 5; // ordinary comment")).toBe(false);
  });
});

describe("renderCompletionReport", () => {
  const gaps = analyzeCompletion(census({ routeGap: { missing: ["/api/ghost"], unused: [] }, sparseDirs: [{ dir: "client", count: 1 }] }));
  const md = renderCompletionReport(gaps, census({ routeGap: { missing: ["/api/ghost"], unused: [] }, sparseDirs: [{ dir: "client", count: 1 }] }), "2026-07-02T00:00:00Z");

  it("has all five sections + the centralized-tests false-positive guard", () => {
    expect(md).toContain("# COMPLETION_GAPS.md");
    expect(md).toContain("§A — Language breakdown");
    expect(md).toContain("§B — Missing code");
    expect(md).toContain("§C — Missing / sparse folders");
    expect(md).toContain("§D — Missing / under-migrated languages");
    expect(md).toContain("§E — Task distribution");
    expect(md).toContain("centralized under `tests/`");
  });
  it("includes justifications + the owning stream in the distribution", () => {
    expect(md).toContain("98 .mjs files still to migrate");
    expect(md).toContain("`mjs-migration`");
    expect(md).toContain("/api/ghost");
  });
});
