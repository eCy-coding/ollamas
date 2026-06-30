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

  it("every roster member carries a measured `fast` boolean", () => {
    for (const m of COUNCIL_ROSTER) expect(typeof m.fast).toBe("boolean");
    // the slow local 30B/32B are tagged not-fast (measured 34.7s/47.8s on the single-GPU box)
    expect(COUNCIL_ROSTER.find((m) => m.model === "qwen3-coder:30b").fast).toBe(false);
    expect(COUNCIL_ROSTER.find((m) => m.model === "deepseek-r1:32b").fast).toBe(false);
    // the fast generalist chair + cloud frontier are fast
    expect(COUNCIL_ROSTER.find((m) => m.model === "qwen3:8b").fast).toBe(true);
    expect(COUNCIL_ROSTER.find((m) => m.model === "gpt-oss:120b-cloud").fast).toBe(true);
  });

  it("DEFAULT selectCouncil seats ONLY fast members (no slow local 30B/32B)", () => {
    const seated = selectCouncil(avail, 5);
    expect(seated.length).toBeGreaterThanOrEqual(2);
    expect(seated.every((m) => m.fast)).toBe(true);
    // the chair (qwen3:8b) leads
    expect(seated[0].model).toBe("qwen3:8b");
    // the slow local 30B/32B are NOT seated by default
    expect(seated.find((m) => m.model === "qwen3-coder:30b")).toBeUndefined();
    expect(seated.find((m) => m.model === "deepseek-r1:32b")).toBeUndefined();
    // only available members sit (openai has no key → excluded)
    expect(seated.find((m) => m.provider === "openai")).toBeUndefined();
  });

  it("{deep:true} re-includes the slow local coder + reasoner", () => {
    const seated = selectCouncil(avail, 5, { deep: true });
    const roles = seated.map((m) => m.role);
    expect(roles).toContain("coder");
    expect(roles).toContain("reasoner");
    expect(seated.find((m) => m.model === "qwen3-coder:30b")).toBeDefined();
    expect(seated.find((m) => m.model === "deepseek-r1:32b")).toBeDefined();
  });

  it("nothing seats when no backend is available (fast or deep)", () => {
    const none = { localModels: [], liveProviders: {}, geminiCli: false };
    expect(selectCouncil(none, 5)).toEqual([]);
    expect(selectCouncil(none, 5, { deep: true })).toEqual([]);
  });

  it("seatLine carries the justification", () => {
    const line = seatLine(COUNCIL_ROSTER[0]);
    expect(line).toContain("Fast Generalist Chair");
    expect(line.toLowerCase()).toContain("tok/s");
  });
});
