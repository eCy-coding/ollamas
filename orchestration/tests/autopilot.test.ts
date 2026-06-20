import { describe, it, expect } from "vitest";
import { summarizeAutopilot, type StepResult } from "../bin/lib/autopilot";

const RESULTS: StepResult[] = [
  { step: "benchprompt", ok: true, ms: 120, detail: "pick qwen3-coder:30b · 119.7 tok/s" },
  { step: "conduct", ok: true, ms: 80, detail: "next: vO8 drift-guard (ROADMAP)" },
  { step: "status", ok: false, ms: 40, detail: "timeout" },
];

describe("summarizeAutopilot — otopilot özeti (PURE, deterministik)", () => {
  const md = summarizeAutopilot(RESULTS, "2026-06-20T10:00:00Z");

  it("her adımı ok/fail işaretiyle listeler", () => {
    expect(md).toContain("benchprompt");
    expect(md).toContain("conduct");
    expect(md).toContain("status");
    expect(md).toMatch(/✓.*benchprompt|benchprompt.*✓/);
    expect(md).toMatch(/✗.*status|status.*✗/);
  });
  it("ok/fail sayımı doğru (2 ok / 1 fail)", () => {
    expect(md).toMatch(/2\/3|2 ok|2 başarılı/);
  });
  it("model-pick + conductor next-action öne çıkar (0-manuel özeti)", () => {
    expect(md).toContain("qwen3-coder:30b");
    expect(md).toMatch(/vO8 drift-guard/);
  });
  it("deterministik — aynı girdi aynı çıktı (Date.now yok)", () => {
    expect(summarizeAutopilot(RESULTS, "2026-06-20T10:00:00Z")).toBe(md);
  });
  it("boş sonuç → graceful (kırılmaz)", () => {
    const empty = summarizeAutopilot([], "t");
    expect(empty).toMatch(/autopilot/i);
    expect(empty).toMatch(/0\/0|adım yok|no step/i);
  });
  it("doctor adımı → readiness satırı (GO/NO-GO) öne çıkar", () => {
    const noGo = summarizeAutopilot([...RESULTS, { step: "doctor", ok: false, ms: 30, detail: "NO-GO — hook-wiring aktif değil" }], "t");
    expect(noGo).toMatch(/Readiness/);
    expect(noGo).toMatch(/NO-GO/);
    const go = summarizeAutopilot([...RESULTS, { step: "doctor", ok: true, ms: 30, detail: "GO — tam canlı" }], "t");
    expect(go).toMatch(/✅ GO/);
  });
  it("heal adımı → staleness self-heal satırı (0-manuel taze)", () => {
    const healed = summarizeAutopilot([{ step: "heal", ok: true, ms: 5000, detail: "🔄 auto-refresh tetiklendi" }, ...RESULTS], "t");
    expect(healed).toMatch(/Staleness self-heal/);
    expect(healed).toMatch(/auto-refresh/);
    // heal adımı yoksa satır görünmez (SessionStart hızlı yol)
    expect(summarizeAutopilot(RESULTS, "t")).not.toMatch(/Staleness self-heal/);
  });
});
