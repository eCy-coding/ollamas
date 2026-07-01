import { describe, it, expect } from "vitest";
import { renderTaskList, ACCEPTANCE, type TaskListInputs } from "../bin/lib/tasklist";

const base: TaskListInputs = {
  ts: "2026-07-02T00:00:00Z",
  doneLog: [{ ver: "vO28", title: "self-heal flaky fix", commit: "6082ddc" }],
  recentCommits: ["6082ddc fix self-heal", "6ea7926 final 3 streams"],
  codings: { done: 6, total: 6 },
  next: { p1: 2, total: 26 },
  think: { proven: 6, needsResearch: 25 },
  gateClean: true,
};

describe("renderTaskList — persistent master task list", () => {
  it("renders the acceptance checklist + status + done-log + next sections", () => {
    const md = renderTaskList(base);
    expect(md).toContain("# MASTER_TASKLIST.md");
    expect(md).toContain("Master-directive acceptance");
    expect(md).toContain("6/6 DONE");
    expect(md).toContain("vO28 — self-heal flaky fix");
    expect(md).toContain("2 P1 safe-additive");
  });
  it("gate-clean acceptance ticks only when gateClean is true", () => {
    expect(renderTaskList({ ...base, gateClean: true })).toContain("[x] **gate-clean**");
    expect(renderTaskList({ ...base, gateClean: false })).toContain("[ ] **gate-clean**");
  });
  it("gateClean=false surfaces the GATE_SKIP warning", () => {
    expect(renderTaskList({ ...base, gateClean: false })).toContain("needs GATE_SKIP");
  });
  it("ACCEPTANCE covers the recurring master-directive keys", () => {
    const ids = ACCEPTANCE.map((a) => a.id);
    for (const k of ["council", "fleet-tabs", "single-gpu", "always-open", "think", "plan-first", "no-half", "evidence"])
      expect(ids).toContain(k);
  });
});
