import { describe, it, expect } from "vitest";
import {
  normVer, laneIdFromPath, checkBranchLane, checkVersionSources,
  chokepointIntegrity, buildDriftReport, exitCode, type DriftRow,
} from "../bin/lib/driftguard";

describe("normVer", () => {
  it("lane-prefix + v atılır, sayısal çekirdek kalır", () => {
    expect(normVer("vO8")).toBe("8");
    expect(normVer("vF9")).toBe("9");
    expect(normVer("v11")).toBe("11");
    expect(normVer("v2.4")).toBe("2.4");
    expect(normVer("vT2")).toBe("2");
    expect(normVer("v10.0.0")).toBe("10.0.0");
  });
  it("sayı yok → boş", () => expect(normVer("feat/x")).toBe(""));
});

describe("laneIdFromPath", () => {
  it("ollamas-<id>-wt → id; ANCHOR → core", () => {
    expect(laneIdFromPath("/U/Desktop/ollamas-orchestration-wt")).toBe("orchestration");
    expect(laneIdFromPath("/U/Desktop/ollamas-frontend-wt")).toBe("frontend");
    expect(laneIdFromPath("/U/Desktop/ollamas")).toBe("core");
  });
});

describe("checkBranchLane (branch-hijack HARD, ERR-ORCH-004)", () => {
  it("doğru lane branch → drift yok", () => {
    expect(checkBranchLane("/x/ollamas-orchestration-wt", "feat/orchestration-v3")).toBeNull();
  });
  it("integrations↔gateway alias → drift yok", () => {
    expect(checkBranchLane("/x/ollamas-integrations-wt", "feat/gateway-v2")).toBeNull();
  });
  it("HIJACK: scripts worktree'de cli branch → HARD", () => {
    const r = checkBranchLane("/x/ollamas-scripts-wt", "feat/cli-v2-clean");
    expect(r?.severity).toBe("hard");
    expect(r?.check).toBe("branch-lane");
  });
  it("core (version-named branch) → atla (null)", () => {
    expect(checkBranchLane("/x/ollamas", "feat/v1.11-roots-abort")).toBeNull();
  });
});

describe("checkVersionSources (single-source-of-truth HARD)", () => {
  it("roadmap == VERSION sabiti → drift yok", () => {
    expect(checkVersionSources({ lane: "cli", roadmapCurrent: "v10", versionConst: "10.0.0" })).toEqual([]);
  });
  it("roadmap ≠ VERSION → HARD declared⇒actual", () => {
    const rows = checkVersionSources({ lane: "cli", roadmapCurrent: "v10", versionConst: "9.0.0" });
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("hard");
    expect(rows[0].declared).toContain("10");
    expect(rows[0].actual).toContain("9");
  });
  it("tek kaynak → karşılaştıramaz → drift yok", () => {
    expect(checkVersionSources({ lane: "x", roadmapCurrent: "vO8" })).toEqual([]);
  });
  it("git tag da çelişirse HARD", () => {
    const rows = checkVersionSources({ lane: "cli", roadmapCurrent: "v10", versionConst: "10.0.0", gitTag: "v8" });
    expect(rows.some((r) => r.source.includes("tag"))).toBe(true);
  });
});

describe("chokepointIntegrity (detectors REUSE, HARD)", () => {
  it("raw fetch (apiClient dışı) → HARD bulgu", () => {
    const rows = chokepointIntegrity("frontend", [
      { path: "src/components/Foo.tsx", content: "const x = await fetch('/api/x');" },
    ]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].severity).toBe("hard");
    expect(rows[0].check).toBe("choke-point");
  });
  it("temiz dosya → drift yok", () => {
    expect(chokepointIntegrity("frontend", [
      { path: "src/lib/apiClient.ts", content: "export const apiClient = {};" },
    ])).toEqual([]);
  });
});

describe("exitCode", () => {
  const hard: DriftRow = { lane: "x", check: "branch-lane", source: "branch", declared: "a", actual: "b", severity: "hard" };
  const soft: DriftRow = { lane: "x", check: "branch-coherence", source: "branch", declared: "a", actual: "b", severity: "soft" };
  it("hard>0 → 1", () => expect(exitCode([soft, hard])).toBe(1));
  it("yalnız soft → 0", () => expect(exitCode([soft])).toBe(0));
  it("boş → 0", () => expect(exitCode([])).toBe(0));
});

describe("buildDriftReport", () => {
  it("declared⇒actual + lane içerir; temizse ✅", () => {
    const rows: DriftRow[] = [
      { lane: "scripts", check: "branch-lane", source: "branch", declared: "lane:scripts", actual: "feat/cli-v2-clean", severity: "hard", note: "hijack" },
    ];
    const md = buildDriftReport(rows);
    expect(md).toContain("⇒");
    expect(md).toContain("scripts");
    expect(buildDriftReport([])).toMatch(/✅|temiz|drift yok/i);
  });
});
