import { describe, it, expect } from "vitest";
import { summarizeAutopilot, type StepResult } from "../bin/lib/autopilot";

const r = (step: string, ok: boolean, extra: Partial<StepResult> = {}): StepResult =>
  ({ step, ok, ms: 10, detail: "d", ...extra });

describe("summarizeAutopilot — stale-fallback rendering", () => {
  it("a timed-out refresh that reused its artefact renders ⏱ and counts as ok (not ✗)", () => {
    const md = summarizeAutopilot([
      r("benchprompt", true),
      r("conduct", true, { stale: true, detail: "⏱ 61s timeout → önceki CONDUCTOR.md korunur (stale)" }),
      r("status", true, { stale: true }),
    ], "2026-01-01T00:00:00Z");
    expect(md).toContain("3/3 adım ok");           // stale steps are NOT failures
    expect(md).toContain("2 ⏱ stale-fallback");    // but staleness is surfaced honestly
    expect(md).toContain("| ⏱ | `conduct`");       // row glyph is ⏱, not ✓/✗
  });

  it("a genuine failure still renders ✗ and drops the count", () => {
    const md = summarizeAutopilot([r("a", true), r("b", false)], "t");
    expect(md).toContain("1/2 adım ok");
    expect(md).toContain("| ✗ | `b`");
    expect(md).not.toContain("stale-fallback");
  });
});
