import { describe, it, expect } from "vitest";
import { CONSTITUTION, CONSTITUTION_VERSION, CONSTITUTION_TRAITS } from "../bin/lib/claude-constitution";

describe("claude-constitution", () => {
  it("has a semver version", () => {
    expect(CONSTITUTION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("is a substantial, non-empty system prompt", () => {
    expect(CONSTITUTION.trim().length).toBeGreaterThan(200);
  });
  it("commits to the HHH + calibration + refusal traits it will be scored on", () => {
    const lower = CONSTITUTION.toLowerCase();
    for (const trait of CONSTITUTION_TRAITS) expect(lower).toContain(trait);
  });
  it("explicitly warns against sycophantic openers (anti-sycophancy)", () => {
    expect(CONSTITUTION.toLowerCase()).toContain("great question");
  });
  it("does not contain a triple-quote fence (safe to embed in a Modelfile SYSTEM block)", () => {
    expect(CONSTITUTION.includes('"""')).toBe(false);
  });
});
