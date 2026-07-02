import { describe, it, expect } from "vitest";
import {
  pendingModels, applyRound, isLoopConverged, shouldContinueLoop, renderAutomatorLoop,
  type AutomatorLoopRound,
} from "../bin/lib/automator-loop";
import { classifyDailyRun } from "../bin/lib/automator-probe";
import type { DispatchReport } from "../bin/lib/chrome-probe";

const REPORT: DispatchReport = { messages: ["VERDICT: DONE"], verdict: "DONE" };
const SCHED = [{ name: "com.ollamas.x.daily.plist", content: "<plist><key>StartCalendarInterval</key></plist>" }];
const ONEOFF = [{ name: "start.sh", content: "make up" }];
const NONE: { name: string; content: string }[] = [];

const recurringRow = (m: string) => classifyDailyRun(m, REPORT, SCHED);
const oneOffRow = (m: string) => classifyDailyRun(m, REPORT, ONEOFF);
const emptyRow = (m: string) => classifyDailyRun(m, { verdict: "INCOMPLETE" }, NONE);

describe("pendingModels — non-recurring are pending", () => {
  it("selects one-off and empty rows, not recurring ones", () => {
    const rows = [recurringRow("a"), oneOffRow("b"), emptyRow("c")];
    expect(pendingModels(rows)).toEqual(["b", "c"]);
  });
});

describe("applyRound — merge by model, never lose a recurring win", () => {
  it("replaces a pending model's row with its fresh (now-recurring) row", () => {
    const rows = [recurringRow("a"), emptyRow("b")];
    const merged = applyRound(rows, [recurringRow("b")]);
    expect(merged.find((r) => r.model === "b")!.scheduled).toBe(true);
    expect(merged.find((r) => r.model === "a")!.scheduled).toBe(true); // untouched
  });
  it("leaves models absent from the round unchanged", () => {
    const rows = [recurringRow("a"), emptyRow("b")];
    const merged = applyRound(rows, [emptyRow("b")]);
    expect(merged.find((r) => r.model === "b")!.scheduled).toBe(false);
    expect(merged).toHaveLength(2);
  });
});

describe("isLoopConverged — every model recurring", () => {
  it("true only when no pending", () => {
    expect(isLoopConverged([recurringRow("a"), recurringRow("b")])).toBe(true);
    expect(isLoopConverged([recurringRow("a"), oneOffRow("b")])).toBe(false);
    expect(isLoopConverged([])).toBe(false);
  });
});

describe("shouldContinueLoop — bounded by rounds and dry cap", () => {
  it("continues while pending, under round cap, not stalled", () => {
    expect(shouldContinueLoop(1, 3, 2, 0, 1)).toBe(true);
  });
  it("stops when no pending", () => {
    expect(shouldContinueLoop(1, 3, 0, 0, 1)).toBe(false);
  });
  it("stops at the round cap", () => {
    expect(shouldContinueLoop(3, 3, 2, 0, 1)).toBe(false);
  });
  it("stops when dry rounds hit the cap (models that can't → don't push forever)", () => {
    expect(shouldContinueLoop(2, 5, 2, 1, 1)).toBe(false);
  });
});

describe("renderAutomatorLoop", () => {
  const rounds: AutomatorLoopRound[] = [
    { round: 1, targets: 3, steps: 6, recurring: 1, newRecurring: 1, pending: 2 },
    { round: 2, targets: 2, steps: 8, recurring: 2, newRecurring: 1, pending: 1 },
  ];

  it("reports NOT CONVERGED with honest remaining when a model stays pending", () => {
    const finalRows = [recurringRow("a"), recurringRow("b"), emptyRow("c")];
    const md = renderAutomatorLoop(rounds, finalRows, 3, "2026-07-02T00:00:00Z");
    expect(md).toContain("# AUTOMATOR_LOOP.md");
    expect(md).toContain("NOT CONVERGED");
    expect(md).toContain("2/3 recurring");
    expect(md).toContain("hesapla → planla → kodla");
    expect(md).toContain("Remaining (honest");
    expect(md).toContain("`c`");
    expect(md).toContain("# AUTOMATOR_DAILY.md"); // final matrix embedded
  });

  it("reports CONVERGED when all recurring", () => {
    const md = renderAutomatorLoop(rounds, [recurringRow("a"), recurringRow("b")], 3, "t");
    expect(md).toContain("CONVERGED ✅");
    expect(md).not.toContain("Remaining (honest");
  });
});
