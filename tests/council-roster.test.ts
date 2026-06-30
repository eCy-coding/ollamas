import { describe, it, expect } from "vitest";
import { COUNCIL_ROSTER, isAvailable, selectCouncil, seatLine } from "../scripts/council-roster.mjs";

describe("council-roster — every seat is justified (proven)", () => {
  it("each member has a valid kind + non-empty specialty/rationale/proof", () => {
    expect(COUNCIL_ROSTER.length).toBeGreaterThanOrEqual(5);
    for (const m of COUNCIL_ROSTER) {
      expect(["local", "cloud", "keyless"]).toContain(m.kind);
      expect(m.id && m.provider && m.specialty && m.rationale && m.proof).toBeTruthy();
      expect(String(m.proof).length).toBeGreaterThan(8); // a real justification, not a stub
    }
  });
  it("covers the diverse roles (chair + coder + reasoner + frontier)", () => {
    const roles = new Set(COUNCIL_ROSTER.map((m) => m.role));
    for (const r of ["chair", "coder", "reasoner", "frontier"]) expect(roles.has(r)).toBe(true);
  });
});

describe("council-roster — availability gating (a member must prove it's alive)", () => {
  const avail = { localModels: ["qwen3:8b", "qwen3-coder:30b", "deepseek-r1:32b"], liveProviders: { gemini: 5, openrouter: 3 }, geminiCli: true };

  it("isAvailable: local needs the installed model; cloud needs a live key; keyless needs the binary", () => {
    expect(isAvailable({ kind: "local", model: "qwen3:8b" }, avail)).toBe(true);
    expect(isAvailable({ kind: "local", model: "not-installed" }, avail)).toBe(false);
    expect(isAvailable({ kind: "cloud", provider: "gemini" }, avail)).toBe(true);
    expect(isAvailable({ kind: "cloud", provider: "openai" }, avail)).toBe(false); // no live key
    expect(isAvailable({ kind: "keyless", provider: "gemini-cli" }, avail)).toBe(true);
  });

  it("selectCouncil seats a diverse, available panel capped at `want`", () => {
    const seated = selectCouncil(avail, 4);
    expect(seated.length).toBeLessThanOrEqual(4);
    expect(seated.length).toBeGreaterThanOrEqual(3);
    // the chair (qwen3:8b) leads
    expect(seated[0].model).toBe("qwen3:8b");
    // only available members sit (openai has no key → excluded)
    expect(seated.find((m) => m.provider === "openai")).toBeUndefined();
    // distinct roles represented
    const roles = seated.map((m) => m.role);
    expect(roles).toContain("coder");
    expect(roles).toContain("reasoner");
  });

  it("nothing seats when no backend is available", () => {
    expect(selectCouncil({ localModels: [], liveProviders: {}, geminiCli: false }, 5)).toEqual([]);
  });

  it("seatLine carries the justification", () => {
    const line = seatLine(COUNCIL_ROSTER[0]);
    expect(line).toContain("Fast Generalist Chair");
    expect(line.toLowerCase()).toContain("tok/s");
  });
});
