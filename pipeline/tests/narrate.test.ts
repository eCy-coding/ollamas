import { describe, it, expect } from "vitest";
import { narratePlan, narrateStep, narrateGates, narrateDecision, narrateAudit, renderNarration, section } from "../lib/narrate";
import { batches, parallelismFactor, type Pipeline } from "../lib/dag";
import { evaluate, decide, type Evidence } from "../lib/gates";
import { audit } from "../lib/audit";
import { summarize } from "../lib/stats";

const wf: Pipeline = {
  workflow_version: "6.0",
  steps: [
    { id: "search", action: "search", output: "sr" },
    { id: "a", action: "test", input: ["sr"], output: "ka", parallel: true },
    { id: "b", action: "security_scan", input: ["sr"], output: "kb", parallel: true },
    { id: "c", action: "merge", input: ["ka", "kb"], output: "kc" },
  ],
};

describe("narratePlan", () => {
  const lines = narratePlan(wf, batches(wf), parallelismFactor(wf));

  it("states the shape of the run", () => {
    expect(lines[0].text).toMatch(/4 adım, 3 dalga, paralellik/);
  });

  it("explains that dependencies are derived, not hand-written", () => {
    expect(lines.some((l) => l.text.includes("girdi/çıktı anahtarlarından türetildi"))).toBe(true);
  });

  it("names the concurrent wave and its members", () => {
    expect(lines.some((l) => l.text.includes("EŞZAMANLI") && l.text.includes("a ∥ b"))).toBe(true);
  });

  it("marks serial steps as assuming the previous one succeeded", () => {
    expect(lines.some((l) => l.text.includes("c") && l.text.includes("sıralı"))).toBe(true);
  });
});

describe("narrateStep", () => {
  it("translates the action and reports the duration", () => {
    expect(narrateStep("search", "search", true, 42).text).toBe("✓ search · bilgi topla · 42 ms");
  });

  it("says degradation was honest rather than hiding it", () => {
    const t = narrateStep("think_x", "think", true, 10, true).text;
    expect(t).toMatch(/dürüst degrade/);
    expect(t).toMatch(/uydurma yok/);
  });

  it("falls back to the raw action name for an unknown step", () => {
    expect(narrateStep("x", "brand_new", false, 5).text).toContain("brand_new");
  });
});

describe("narrateGates", () => {
  const ev: Evidence = {
    steps: { think: summarize([200]), sandbox_test: summarize([40]) },
    total: summarize([1000]),
    errorRatePct: 0,
    coveragePct: 99,
    chaosSuccess: 1,
    // security deliberately absent → MISS
  };

  // The distinction this whole pipeline refuses to blur.
  it("spells a MISS as 'ölçülmedi', neither passed nor failed", () => {
    const l = narrateGates(evaluate(ev)).find((x) => x.text.includes("security"))!;
    expect(l.text).toContain("ÖLÇÜLMEDİ");
    expect(l.text).toContain("geçti sayılmaz");
  });

  it("shows measured value against the limit for a passing gate", () => {
    const l = narrateGates(evaluate(ev)).find((x) => x.text.includes("coverage"))!;
    expect(l.text).toMatch(/✓ coverage: 99 \/ sınır 90/);
  });

  it("says SINIR AŞILDI on a breach", () => {
    const bad = narrateGates(evaluate({ ...ev, coveragePct: 10 })).find((x) => x.text.includes("coverage"))!;
    expect(bad.text).toContain("SINIR AŞILDI");
  });
});

describe("narrateDecision", () => {
  const good: Evidence = {
    steps: { think: summarize([200]), sandbox_test: summarize([40]) },
    total: summarize([1000, 1100, 1200]),
    errorRatePct: 0, coveragePct: 99, security: { high: 0 }, chaosSuccess: 1,
    totals: [1000, 1100, 1200],
  };

  it("reports a pass plainly", () => {
    expect(narrateDecision(decide(good))[0].text).toMatch(/GEÇ — yedi kapının hepsi/);
  });

  it("names the gates that failed", () => {
    const t = narrateDecision(decide({ ...good, coveragePct: 1 }))[0].text;
    expect(t).toMatch(/GEÇME/);
    expect(t).toContain("coverage");
  });

  // Weak evidence must be surfaced, and must NOT be described as a relaxation.
  it("flags weak evidence without implying the gates were loosened", () => {
    const lines = narrateDecision(decide({ ...good, totals: [1000] }));
    const w = lines.find((l) => l.text.includes("ZAYIF"))!;
    expect(w.text).toContain("Kapılar gevşetilmedi");
  });
});

describe("narrateAudit", () => {
  it("says so when there are no blind spots", () => {
    const full = audit({
      metricsObserved: true, cacheExercised: true, parallelismUsed: true, warmPoolUsed: true,
      ciGatePresent: true, securityScanRan: true, chaosRan: true, coverageMeasured: true,
      reproducibleArtifact: true, repeatedRuns: true,
    });
    expect(narrateAudit(full)[0].text).toMatch(/kör nokta yok/);
  });

  it("explains why a gap downgrades the run and lists corrective tasks", () => {
    const lines = narrateAudit(audit({ metricsObserved: true }));
    expect(lines[0].text).toMatch(/eksik:/);
    expect(lines.some((l) => l.text.includes("çalıştığı varsayılan bir yetenektir"))).toBe(true);
    expect(lines.some((l) => /→ A\d+ \[/.test(l.text))).toBe(true);
  });
});

describe("renderNarration / section", () => {
  it("prefixes each kind with its own mark", () => {
    const out = renderNarration([{ kind: "decision", text: "x" }, { kind: "wave", text: "y" }]);
    expect(out[0].startsWith("■ ")).toBe(true);
    expect(out[1].startsWith("│ ")).toBe(true);
  });

  it("draws a fixed-width section rule", () => {
    expect(section("KAPILAR")[1]).toMatch(/^── KAPILAR ─+/);
  });
});
