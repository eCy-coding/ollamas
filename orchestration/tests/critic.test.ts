import { describe, it, expect } from "vitest";
import {
  keywords, auditRoadmapSync, auditOrphans, auditCoverage, auditDuplication, scoreCompleteness, auditAll,
} from "../bin/lib/critic";

describe("keywords", () => {
  it("anlamlı 4+ harf kelimeler, stopword atılır", () => {
    const k = keywords("Heartbeat/notification (idle-lane tespiti)");
    expect(k).toContain("heartbeat");
    expect(k).toContain("notification");
    expect(k).not.toContain("tüm");
  });
});

describe("auditRoadmapSync — roadmap-vs-gerçek", () => {
  const md = [
    "| **vO1** | ✅ DONE | Bootstrap status matrisi |",
    "| vO9 | planned | Heartbeat notification idle-lane |",   // heartbeat.ts VAR → drift
    "| vO11 | planned | Quantum teleport gateway |",          // kanıt yok → temiz planned
  ].join("\n");
  it("planned ama araç-var → roadmap-drift (high)", () => {
    const gaps = auditRoadmapSync(md, ["heartbeat.ts", "status.ts"]);
    const drift = gaps.find((g) => g.kind === "roadmap-drift");
    expect(drift?.target).toBe("vO9");
    expect(drift?.severity).toBe("high");
  });
  it("DONE + kanıt-var → temiz (gap yok)", () => {
    const gaps = auditRoadmapSync("| **vO1** | ✅ DONE | status matrisi |", ["status.ts"]);
    expect(gaps.find((g) => g.target === "vO1")).toBeUndefined();
  });
  it("DONE + kanıt-yok → done-no-evidence", () => {
    const gaps = auditRoadmapSync("| **vO5** | ✅ DONE | hayalet özellik |", ["status.ts"]);
    expect(gaps.find((g) => g.kind === "done-no-evidence")?.target).toBe("vO5");
  });
});

describe("auditOrphans", () => {
  it("kaynak referansı olmayan JSON → orphan", () => {
    const gaps = auditOrphans(["OPTIMAL.json", "BENCH.json"], "readJson('BENCH.json')");
    expect(gaps.find((g) => g.target === "OPTIMAL.json")).toBeTruthy();
    expect(gaps.find((g) => g.target === "BENCH.json")).toBeUndefined();
  });
  it("rapor MD (json/_prompt değil) → denetlenmez", () => {
    expect(auditOrphans(["CONDUCTOR.md", "ROLE.md"], "")).toEqual([]);
  });
});

describe("auditCoverage", () => {
  it("test'siz export → coverage-gap", () => {
    const gaps = auditCoverage([{ file: "x.ts", fns: ["doThing", "untested"] }], "expect(doThing()).toBe(1)");
    expect(gaps[0].detail).toMatch(/untested/);
    expect(gaps[0].detail).not.toMatch(/doThing/);
  });
  it("hepsi test'li → gap yok", () => {
    expect(auditCoverage([{ file: "x.ts", fns: ["a"] }], "a() test")).toEqual([]);
  });
});

describe("auditDuplication", () => {
  it("amaç-örtüşmesi yüksek → dup", () => {
    const gaps = auditDuplication([
      { name: "optimize.ts", purpose: "benchmark optimal model config seçer prompt üretir" },
      { name: "benchprompt.ts", purpose: "benchmark optimal model config prompt üretir" },
    ]);
    expect(gaps[0].kind).toBe("duplication");
    expect(gaps[0].target).toMatch(/optimize.*benchprompt/);
  });
  it("ayrık amaç → dup yok", () => {
    expect(auditDuplication([
      { name: "status.ts", purpose: "lane durum matrisi git" },
      { name: "adopt.ts", purpose: "lisans disiplini gate" },
    ])).toEqual([]);
  });
  it("FP-regression: yalnız corpus-common (yüksek-DF) kelime paylaşımı → dup YOK (ERR-ORCH-016)", () => {
    // autopilot↔horizon FP analoğu: ortak kelimeler corpus'ta her tool'da → yüksek-DF → ayırt-edici değil.
    const gaps = auditDuplication([
      { name: "autopilot.ts", purpose: "orchestration çalıştır auto manuel chainrunner zincir" },
      { name: "horizon.ts", purpose: "orchestration çalıştır auto manuel roadmapgen ufuk" },
      { name: "doctor.ts", purpose: "orchestration çalıştır auto manuel readiness teşhis" },
      { name: "status.ts", purpose: "orchestration çalıştır auto manuel matris durum" },
    ]);
    expect(gaps).toEqual([]);
  });
  it("corpus içinde GERÇEK dup (distinktif ortak kelime) → flag", () => {
    // alpha/beta/gamma yalnız 2 tool'da (düşük-DF, distinktif) → gerçek örtüşme yakalanır.
    const gaps = auditDuplication([
      { name: "dupA.ts", purpose: "orchestration çalıştır alpha beta gamma" },
      { name: "dupB.ts", purpose: "orchestration çalıştır alpha beta gamma" },
      { name: "other1.ts", purpose: "orchestration çalıştır delta" },
      { name: "other2.ts", purpose: "orchestration çalıştır epsilon" },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].target).toMatch(/dupA.*dupB/);
  });
});

describe("scoreCompleteness — deterministik", () => {
  it("gap yok → 100", () => {
    expect(scoreCompleteness([])).toBe(100);
  });
  it("severity-ağırlıklı ceza", () => {
    const s = scoreCompleteness([
      { kind: "roadmap-drift", severity: "high", target: "x", detail: "", action: "" },
      { kind: "coverage-gap", severity: "low", target: "y", detail: "", action: "" },
    ]);
    expect(s).toBe(100 - 12 - 2); // 86
  });
  it("aynı girdi → aynı skor", () => {
    const g = [{ kind: "duplication" as const, severity: "med" as const, target: "a", detail: "", action: "" }];
    expect(scoreCompleteness(g)).toBe(scoreCompleteness(g));
  });
});

describe("auditAll — birleşik", () => {
  it("tüm denetçileri çalıştırır", () => {
    const gaps = auditAll({
      roadmapMd: "| vO9 | planned | heartbeat notification |",
      toolNames: ["heartbeat.ts"], artifactNames: ["OPTIMAL.json"],
      allSourceText: "no refs here", exportsByFile: [{ file: "x.ts", fns: ["fn1"] }],
      testText: "", tools: [],
    });
    expect(gaps.find((g) => g.kind === "roadmap-drift")).toBeTruthy();
    expect(gaps.find((g) => g.kind === "orphan-artifact")).toBeTruthy();
    expect(gaps.find((g) => g.kind === "coverage-gap")).toBeTruthy();
  });
});
