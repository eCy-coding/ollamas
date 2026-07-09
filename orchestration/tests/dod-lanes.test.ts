import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLane, lanePrefixes, laneRegistry, type LaneConfig } from "../bin/lib/dod-lanes";

// Fixture repo: 1 tool dosyası (export + gerçek marker) + 1 test'siz export helper.
let root: string;
let cfg: LaneConfig;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dodlanes-"));
  const laneDir = join(root, "lane");
  const libDir = join(laneDir, "lib");
  const testDir = join(root, "tests");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  // tool: export'lu + testte anılıyor + 1 gerçek marker (R5).
  writeFileSync(join(laneDir, "widget.ts"), "// TODO: real unfinished marker\nexport function widget() { return 1; }\n");
  // helper: export'lu ama HİÇBİR testte anılmıyor (R1 lapse) + marker yok.
  writeFileSync(join(libDir, "orphan.ts"), "export function orphan() { return 2; }\n");
  // test: yalnız widget'ı anıyor.
  writeFileSync(join(testDir, "widget.test.ts"), "import { widget } from '../lane/widget';\nwidget();\n");

  cfg = {
    id: "fixture",
    srcDirs: [laneDir, libDir],
    testGlobs: [join(testDir, "*.test.ts")],
  };
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("auditLane — fixture lane", () => {
  it("test'siz export helper → code-without-test (high) lapse", () => {
    const a = auditLane(cfg, [], root);
    const r1 = a.lapses.filter((l) => l.rule === "code-without-test");
    expect(r1).toHaveLength(1);
    expect(r1[0].severity).toBe("high");
    expect(r1[0].target).toBe("lib/orphan.ts");
    expect(a.counts.r1).toBe(1);
  });

  it("gerçek marker → marker (low) lapse; widget testte anılıyor → R1'de yok", () => {
    const a = auditLane(cfg, [], root);
    const markers = a.lapses.filter((l) => l.rule === "marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].severity).toBe("low");
    expect(markers[0].target).toBe("widget.ts");
    // widget test'te geçiyor → R1'de code-without-test yok
    expect(a.lapses.some((l) => l.rule === "code-without-test" && l.target === "widget.ts")).toBe(false);
  });

  it("toolFileCount/libFileCount ayrımı (tool=base seviyesi, helper=alt-dizin)", () => {
    const a = auditLane(cfg, [], root);
    expect(a.toolFileCount).toBe(1); // widget.ts
    expect(a.libFileCount).toBe(1);  // lib/orphan.ts
  });

  it("roadmap/seyir yok → R2/R4/R6 çalışmaz (0)", () => {
    const a = auditLane(cfg, [], root);
    expect(a.counts.r2).toBe(0);
    expect(a.counts.r4).toBe(0);
    expect(a.counts.r6).toBe(0);
  });

  it("allowNoTests → R1 atlanır", () => {
    const a = auditLane({ ...cfg, allowNoTests: true }, [], root);
    expect(a.counts.r1).toBe(0);
    expect(a.lapses.some((l) => l.rule === "code-without-test")).toBe(false);
  });

  it("R3 uncommitted: lane path-prefix'ine göre filtreli + skor deterministik", () => {
    const a = auditLane(cfg, [`?? lane/newfile.ts`], root);
    // 'lane' prefix'i → newfile.ts uncommitted-green
    const r3 = a.lapses.filter((l) => l.rule === "uncommitted-green");
    expect(r3).toHaveLength(1);
    // deterministik: aynı girdi → aynı skor
    expect(auditLane(cfg, [], root).score).toBe(auditLane(cfg, [], root).score);
  });
});

describe("lanePrefixes", () => {
  it("srcDirs → repo-relative ilk segment set", () => {
    expect(lanePrefixes("/repo", ["/repo/orchestration/bin", "/repo/orchestration/bin/lib"])).toEqual(["orchestration"]);
    expect(lanePrefixes("/repo", ["/repo/server", "/repo/cli/bin"])).toEqual(["server", "cli"]);
  });
});

describe("laneRegistry", () => {
  it("orchestration + 6 lane cfg; orchestration'da roadmap+seyir set", () => {
    const reg = laneRegistry("/repo");
    expect(reg.map((c) => c.id)).toEqual(["orchestration", "server", "cli", "src", "contract", "tunnel", "bridge"]);
    const orch = reg.find((c) => c.id === "orchestration")!;
    expect(orch.roadmap).toBeTruthy();
    expect(orch.seyir).toBeTruthy();
    expect(reg.find((c) => c.id === "bridge")!.allowNoTests).toBe(true);
    // lane-cfg server/cli/src/contract: roadmap/seyir yok (R1/R3/R5 only)
    for (const id of ["server", "cli", "src", "contract"]) {
      const c = reg.find((x) => x.id === id)!;
      expect(c.roadmap).toBeUndefined();
      expect(c.seyir).toBeUndefined();
    }
  });
});
