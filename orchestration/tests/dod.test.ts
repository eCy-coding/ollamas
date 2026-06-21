import { describe, it, expect } from "vitest";
import {
  auditTests, auditUncommitted, auditMarkers, auditConcurrent, auditGovernance, auditRoadmapCoherence, scoreDoD,
  type Lapse,
} from "../bin/lib/dod";

describe("auditTests — R1 yarım iş", () => {
  it("export'lu modül test'te yok → Lapse (high)", () => {
    const l = auditTests([{ file: "lib/foo.ts", fnCount: 3 }], "describe('bar')");
    expect(l).toHaveLength(1);
    expect(l[0].rule).toBe("code-without-test");
    expect(l[0].severity).toBe("high");
  });
  it("test'te geçiyor → temiz", () => {
    expect(auditTests([{ file: "lib/foo.ts", fnCount: 3 }], "import { x } from '../bin/lib/foo'")).toEqual([]);
  });
  it("export'suz (CLI) → atlanır", () => {
    expect(auditTests([{ file: "cli.ts", fnCount: 0 }], "")).toEqual([]);
  });
});

describe("auditUncommitted — R3", () => {
  it("orchestration .ts/.md untracked → unshipped Lapse", () => {
    const l = auditUncommitted(["?? orchestration/bin/dod.ts", "?? orchestration/DOD.md"]);
    expect(l).toHaveLength(1);
    expect(l[0].rule).toBe("uncommitted-green");
  });
  it(".bak/.tmp atlanır; temiz → yok", () => {
    expect(auditUncommitted(["?? orchestration/x.bak"])).toEqual([]);
    expect(auditUncommitted([])).toEqual([]);
  });
});

describe("auditMarkers — R5", () => {
  it("count>0 → Lapse", () => {
    const l = auditMarkers([{ file: "a.ts", count: 2 }, { file: "b.ts", count: 0 }]);
    expect(l).toHaveLength(1);
    expect(l[0].target).toBe("a.ts");
  });
});

describe("auditConcurrent — R6 eş-zamanlı gereken", () => {
  it("test+roadmap var ama SEYIR yok → concurrent Lapse (eksik: SEYIR)", () => {
    const l = auditConcurrent(["bench"], new Set(["bench"]), "vO6 bench DONE", "");
    expect(l).toHaveLength(1);
    expect(l[0].concurrent).toBe(true);
    expect(l[0].detail).toMatch(/SEYIR/);
  });
  it("hiçbiri yok → Lapse yok (present=0)", () => {
    expect(auditConcurrent(["ghost"], new Set(), "", "")).toEqual([]);
  });
  it("üçü de var → temiz (present=3)", () => {
    expect(auditConcurrent(["bench"], new Set(["bench"]), "bench roadmap", "bench seyir")).toEqual([]);
  });
});

describe("auditGovernance — R4", () => {
  it("DONE ama SEYIR'de yok → Lapse", () => {
    const l = auditGovernance(["vO9", "vO1"], "vO1 yapıldı");
    expect(l.map((x) => x.target)).toEqual(["vO9"]);
  });
});

describe("auditRoadmapCoherence — R2", () => {
  it("roadmap'te anılmayan araç → izlenebilirlik Lapse", () => {
    const l = auditRoadmapCoherence(["conduct", "status"], "status matrisi vardır");
    expect(l.map((x) => x.target)).toEqual(["conduct"]);
  });
});

describe("scoreDoD — deterministik", () => {
  it("lapse yok → 100", () => {
    expect(scoreDoD([])).toBe(100);
  });
  it("severity-ağırlıklı", () => {
    const ls: Lapse[] = [
      { rule: "code-without-test", severity: "high", target: "x", detail: "", action: "" },
      { rule: "marker", severity: "low", target: "y", detail: "", action: "" },
    ];
    expect(scoreDoD(ls)).toBe(100 - 10 - 1); // 89
  });
  it("aynı girdi → aynı skor", () => {
    const ls: Lapse[] = [{ rule: "marker", severity: "low", target: "a", detail: "", action: "" }];
    expect(scoreDoD(ls)).toBe(scoreDoD(ls));
  });
});
