import { describe, it, expect } from "vitest";
import { parseArgs, pickCouncilModels, buildMemberPrompt, COUNCIL_RULES } from "../scripts/council-debate.mjs";

describe("council-debate — pure helpers", () => {
  it("parseArgs: flags + positional topic, rounds clamped 1..5", () => {
    expect(parseArgs(["--topic", "x", "--models", "a,b", "--rounds", "3"])).toEqual({ topic: "x", models: "a,b", rounds: 3, here: false, deep: false });
    expect(parseArgs(["just a topic"]).topic).toBe("just a topic");
    expect(parseArgs(["--rounds", "99"]).rounds).toBe(5);  // clamp to max
    expect(parseArgs(["--rounds", "0"]).rounds).toBe(2);   // 0/invalid → default 2
    expect(parseArgs(["--rounds", "1"]).rounds).toBe(1);   // valid min honored
    expect(parseArgs(["--here", "--topic", "q"]).here).toBe(true);
    expect(parseArgs(["--deep", "--topic", "q"]).deep).toBe(true);  // deep panel opt-in
  });

  it("pickCouncilModels: champion first, then distinct installed, capped at `want`", () => {
    expect(pickCouncilModels(["qwen3-coder:30b", "qwen3:8b", "phi4", "llama3.3:70b"], "qwen3:8b", 3))
      .toEqual(["qwen3:8b", "qwen3-coder:30b", "phi4"]);
    // champion absent → just the installed order
    expect(pickCouncilModels(["a", "b"], "qwen3:8b", 3)).toEqual(["a", "b"]);
    // never invents a model
    expect(pickCouncilModels([], "qwen3:8b", 3)).toEqual([]);
  });

  it("buildMemberPrompt: round-1 asks an initial position; later rounds inject the transcript to react to", () => {
    const r1 = buildMemberPrompt(COUNCIL_RULES, "konu?", []);
    expect(r1).toContain("KONU: konu?");
    expect(r1).toContain("İlk konumunu");
    expect(r1).not.toContain("ÖNCEKİ TUR");
    const r2 = buildMemberPrompt(COUNCIL_RULES, "konu?", [{ model: "m1", text: "pozisyon A" }]);
    expect(r2).toContain("ÖNCEKİ TUR");
    expect(r2).toContain("### m1");
    expect(r2).toContain("pozisyon A");
    expect(r2).toContain("Diğerlerine yanıt ver");
  });

  it("COUNCIL_RULES carries the operator constraints (single answer, real evidence, honest 'fikrim yok')", () => {
    expect(COUNCIL_RULES).toContain("TEK cevap");
    expect(COUNCIL_RULES).toContain("fikrim yok");
    expect(COUNCIL_RULES.toLowerCase()).toContain("kanıt");
  });
});
