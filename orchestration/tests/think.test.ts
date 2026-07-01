import { describe, it, expect } from "vitest";
import { classify, think, thinkAll, findingText, renderThink, type RegistryEntry } from "../bin/lib/think";

const REG: RegistryEntry[] = [
  { category: "starvation", pattern: "starv|waiting for gpu", provenSolution: "ticket-lock", sources: ["Lamport bakery"], evidence: "gpu-lock.ts" },
  { category: "transient-error", pattern: "timeout|503|ECONNRESET", provenSolution: "backoff+jitter", sources: ["AWS"], evidence: "backoff.ts" },
  { category: "model-blocked", pattern: "blocked|not gated", provenSolution: "conductor escalation", sources: ["directive"], evidence: ".conductor.json" },
];

describe("findingText — normalize", () => {
  it("joins fields", () => {
    expect(findingText({ kind: "RED", target: "gpu", detail: "waiting for gpu" })).toContain("waiting for gpu");
  });
});

describe("classify — first matching registry entry (deterministic)", () => {
  it("starvation", () => expect(classify({ detail: "local agent waiting for GPU 6min" }, REG)?.category).toBe("starvation"));
  it("transient", () => expect(classify({ text: "HTTP 503 from cloud" }, REG)?.category).toBe("transient-error"));
  it("unknown → null", () => expect(classify({ text: "some brand new issue xyz" }, REG)).toBeNull());
});

describe("think — PROVEN vs NEEDS_RESEARCH (no-guess law)", () => {
  it("known problem → PROVEN with sources", () => {
    const r = think({ detail: "starvation on gpu queue" }, REG);
    expect(r.status).toBe("PROVEN");
    if (r.status === "PROVEN") { expect(r.solution).toBe("ticket-lock"); expect(r.sources.length).toBeGreaterThan(0); }
  });
  it("UNKNOWN problem → NEEDS_RESEARCH (never invents a fix)", () => {
    const r = think({ text: "completely novel failure mode qwerty" }, REG);
    expect(r.status).toBe("NEEDS_RESEARCH");
  });
  it("entry with no sources is NOT treated as proven", () => {
    const noSrc: RegistryEntry[] = [{ category: "x", pattern: "boom", provenSolution: "guess", sources: [], evidence: "" }];
    expect(think({ text: "boom happened" }, noSrc).status).toBe("NEEDS_RESEARCH");
  });
});

describe("thinkAll + renderThink", () => {
  const s = thinkAll([{ detail: "waiting for gpu" }, { text: "503 error" }, { text: "mystery bug" }], REG);
  it("counts proven vs needs-research", () => {
    expect(s.total).toBe(3);
    expect(s.proven).toBe(2);
    expect(s.needsResearch).toBe(1);
  });
  it("renders sources for proven + research flag for unknown", () => {
    const md = renderThink(s, "2026-07-01T00:00:00Z");
    expect(md).toContain("Sources:");
    expect(md).toContain("NEEDS_RESEARCH");
    expect(md).toContain("do NOT guess");
  });
});
