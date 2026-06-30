import { describe, it, expect } from "vitest";
import { poolHealthLine, assess } from "../scripts/gemini-pool-check.mjs";
import { rankResults } from "../scripts/provider-bench.mjs";

describe("gemini-pool-check helpers", () => {
  it("poolHealthLine reports state + req-left", () => {
    expect(poolHealthLine({ total: 9, live: 3 })).toBe("gemini pool: OK · live 3/9 · ~60 req left today");
    expect(poolHealthLine({ total: 9, live: 0 })).toContain("DRY");
    expect(poolHealthLine({ total: 0, live: 0 })).toContain("UNCONFIGURED");
    expect(poolHealthLine(null)).toContain("UNCONFIGURED");
  });

  it("assess flags dry (exit 2 + alert) only when keys exist but none live", () => {
    expect(assess({ total: 9, live: 2 })).toEqual({ dry: false, code: 0, alert: null });
    const dry = assess({ total: 9, live: 0 });
    expect(dry.dry).toBe(true);
    expect(dry.code).toBe(2);
    expect(dry.alert).toContain("DRY");
    expect(assess({ total: 0, live: 0 }).dry).toBe(false); // unconfigured ≠ dry
  });
});

describe("provider-bench rankResults", () => {
  it("ranks by success-rate desc then latency asc", () => {
    const ranked = rankResults([
      { provider: "slow", n: 3, ok: 3, avgMs: 33000, source: "cli" },
      { provider: "fast", n: 3, ok: 3, avgMs: 1230, source: "cloud" },
      { provider: "flaky", n: 3, ok: 1, avgMs: 500, source: "x" },
    ]);
    expect(ranked.map((r) => r.provider)).toEqual(["fast", "slow", "flaky"]);
  });
});
