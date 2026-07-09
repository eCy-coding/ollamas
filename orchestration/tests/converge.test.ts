// converge.test.ts — pure-function slice of bin/converge.ts (no git, no fs, no ref writes).
// Covers conflict classification (policy zones), convergence lane ordering (security-first,
// key-autonomy-last), conflict-zone forecasting (intersection + classify), the per-lane plan
// shape, and the deferred execute-command builder (must never emit `git add -A`).
import { describe, it, expect } from "vitest";
import {
  classifyConflict,
  laneRank,
  mergeOrder,
  forecastZones,
  planLane,
  buildExecuteCommands,
  DEFAULT_INTEGRATION,
} from "../bin/converge";

describe("classifyConflict", () => {
  it("security workflow + semgrep guards → security-wins", () => {
    expect(classifyConflict(".github/workflows/security.yml")).toBe("security-wins");
    expect(classifyConflict(".semgrep/no-shell-exec.yml")).toBe("security-wins");
    expect(classifyConflict("docs/audit/SEC-BASELINE.md")).toBe("security-wins");
  });
  it("generated orchestration artifacts → regenerate", () => {
    expect(classifyConflict("orchestration/out/LANE_TRIAGE.md")).toBe("regenerate");
    expect(classifyConflict("orchestration/CRITIC.json")).toBe("regenerate");
    expect(classifyConflict("orchestration/COUNCIL.json")).toBe("regenerate");
    expect(classifyConflict("orchestration/DOD_LANES.json")).toBe("regenerate");
    expect(classifyConflict("orchestration/TASKS.json")).toBe("regenerate");
  });
  it("manifests + gitignore → union", () => {
    expect(classifyConflict("package.json")).toBe("union");
    expect(classifyConflict("package-lock.json")).toBe("union");
    expect(classifyConflict(".gitignore")).toBe("union");
  });
  it("everything else → hand-merge", () => {
    expect(classifyConflict("src/lib/apiClient.ts")).toBe("hand-merge");
    expect(classifyConflict("orchestration/bin/converge.ts")).toBe("hand-merge");
  });
});

describe("laneRank / mergeOrder", () => {
  it("ranks security first, key-autonomy last, others middle", () => {
    expect(laneRank("fix/audit-security")).toBe(0);
    expect(laneRank("feat/orchestra-conductor")).toBe(1);
    expect(laneRank("feat/key-autonomy")).toBe(2);
  });
  it("orders security-first → key-autonomy-last, alpha in the middle", () => {
    const lanes = ["feat/key-autonomy", "feat/orchestra-conductor", "fix/audit-security", "chore/p1-hardening"];
    expect(mergeOrder(lanes)).toEqual([
      "fix/audit-security",
      "chore/p1-hardening",
      "feat/orchestra-conductor",
      "feat/key-autonomy",
    ]);
  });
  it("does not mutate input", () => {
    const lanes = ["feat/b", "feat/a"];
    const before = [...lanes];
    mergeOrder(lanes);
    expect(lanes).toEqual(before);
  });
});

describe("forecastZones", () => {
  it("intersects trunk/lane changed files and tags each with its policy", () => {
    const trunk = [".github/workflows/security.yml", "package.json", "src/only-trunk.ts"];
    const lane = ["package.json", ".github/workflows/security.yml", "src/only-lane.ts"];
    expect(forecastZones(trunk, lane)).toEqual([
      { path: ".github/workflows/security.yml", policy: "security-wins" },
      { path: "package.json", policy: "union" },
    ]);
  });
  it("empty when no path changed on both sides", () => {
    expect(forecastZones(["a.ts"], ["b.ts"])).toEqual([]);
  });
  it("dedupes and ignores blank lines", () => {
    expect(forecastZones(["x.ts", "x.ts", "  "], ["x.ts", ""])).toEqual([{ path: "x.ts", policy: "hand-merge" }]);
  });
});

describe("planLane", () => {
  const plan = planLane("feat/orchestra-conductor", {
    trunk: "feat/key-autonomy",
    integration: DEFAULT_INTEGRATION,
    remaining: ["fix/audit-security", "chore/p1-hardening", "feat/orchestra-conductor"],
  });
  it("emits the 6-step lane→integration→[T0]→re-merge sequence", () => {
    expect(plan.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.steps.find((s) => s.kind === "t0")?.detail).toContain("[T0]");
  });
  it("re-merge step lists remaining lanes in convergence order, self excluded", () => {
    expect(plan.remaining).toEqual(["fix/audit-security", "chore/p1-hardening"]);
    expect(plan.steps[5].detail).toContain("fix/audit-security, chore/p1-hardening");
  });
  it("gates never write refs; merges + T0 do", () => {
    for (const s of plan.steps) {
      expect(s.refWrite).toBe(s.kind !== "gate");
    }
  });
  it("omits the re-merge step when no lanes remain", () => {
    const solo = planLane("feat/key-autonomy", { trunk: "main", integration: DEFAULT_INTEGRATION, remaining: [] });
    expect(solo.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("buildExecuteCommands", () => {
  const plan = planLane("feat/x", { trunk: "main", integration: DEFAULT_INTEGRATION, remaining: ["feat/y"] });
  const cmds = buildExecuteCommands(plan);
  it("never emits `git add -A` (path-scoped staging is decided at execute time)", () => {
    for (const c of cmds) {
      expect(c.join(" ")).not.toContain("add -A");
    }
  });
  it("renders the lane→integration merge argv + a re-merge per remaining lane", () => {
    expect(cmds).toContainEqual(["git", "merge", "--no-ff", "--no-edit", "feat/x"]);
    expect(cmds).toContainEqual(["git", "merge", "--no-edit", "feat/y"]);
  });
});
