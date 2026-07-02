import { describe, it, expect } from "vitest";
import { scoreAutomation, rankAutomations, installCommand, renderBestReport, type BestPick } from "../bin/lib/automator-best";
import type { DailyRow } from "../bin/lib/automator-probe";

const row = (over: Partial<DailyRow>): DailyRow => ({
  model: "m", provider: "ollama-local", produced: true, fileCount: 3, kinds: ["plist", "shell", "readme"],
  verdict: "OK", artifacts: [], note: "", scheduled: true, mechanism: "launchd", markers: [], ...over,
});

describe("scoreAutomation", () => {
  it("is 0 for a non-recurring automation", () => {
    expect(scoreAutomation(row({ scheduled: false }))).toBe(0);
  });
  it("rewards a complete launchd bundle (plist+shell+readme) over a bare one", () => {
    const full = scoreAutomation(row({ kinds: ["plist", "shell", "readme"], fileCount: 3 }));
    const bare = scoreAutomation(row({ kinds: ["shell"], fileCount: 1 }));
    expect(full).toBeGreaterThan(bare);
  });
  it("prefers launchd over cron for the same coverage", () => {
    expect(scoreAutomation(row({ mechanism: "launchd" }))).toBeGreaterThan(scoreAutomation(row({ mechanism: "cron" })));
  });
});

describe("rankAutomations", () => {
  it("drops non-recurring and sorts best-first, stable on ties", () => {
    const rows = [
      row({ model: "weak", kinds: ["plist"], fileCount: 1 }),
      row({ model: "not-recurring", scheduled: false }),
      row({ model: "full-a", kinds: ["plist", "shell", "readme"], fileCount: 4 }),
      row({ model: "full-b", kinds: ["plist", "shell", "readme"], fileCount: 4 }),
    ];
    const ranked = rankAutomations(rows);
    expect(ranked.map((r) => r.model)).toEqual(["full-a", "full-b", "weak"]); // non-recurring dropped, ties stable
  });
});

describe("installCommand", () => {
  it("builds the launchctl load one-liner for the bundled plist", () => {
    const cmd = installCommand("com.ollamas.daily-health.plist");
    expect(cmd).toContain("~/Library/LaunchAgents/com.ollamas.daily-health.plist");
    expect(cmd).toContain("launchctl load");
    expect(cmd).toContain("BEST/com.ollamas.daily-health.plist");
  });
});

describe("renderBestReport", () => {
  const ranked = rankAutomations([
    row({ model: "gpt-oss:20b", artifacts: [{ name: "com.ollamas.daily-health.plist", kind: "plist" }, { name: "daily-health.sh", kind: "shell" }] }),
    row({ model: "phi4", kinds: ["plist", "shell"], fileCount: 2 }),
  ]);
  const winner: BestPick = { row: ranked[0], score: scoreAutomation(ranked[0]), validation: { ok: true, plist: "OK", script: "OK", detail: "plist OK · script OK" } };

  it("shows winner, validated badge, one-command install and the ranking table", () => {
    const md = renderBestReport(ranked, winner, "2026-07-02T00:00:00Z");
    expect(md).toContain("# AUTOMATOR_BEST.md");
    expect(md).toContain("Winner: `gpt-oss:20b`");
    expect(md).toContain("✅ validated");
    expect(md).toContain("launchctl load ~/Library/LaunchAgents/com.ollamas.daily-health.plist");
    expect(md).toContain("Ranking — who produced what");
    expect(md).toContain("`phi4`");
  });

  it("handles no valid winner honestly", () => {
    const md = renderBestReport(ranked, null, "t");
    expect(md).toContain("Winner: (none)");
  });
});
