import { describe, it, expect } from "vitest";
import { evalArithmetic, stripThink, formatCertain } from "../src/lib/certainty";

describe("certainty — evalArithmetic (definitive, source-of-truth)", () => {
  it("answers 2+2=? as exactly 4", () => {
    expect(evalArithmetic("2+2=?")).toEqual({ expr: "2+2", value: 4 });
  });

  it("respects operator precedence", () => {
    expect(evalArithmetic("17*23=?")?.value).toBe(391);
    expect(evalArithmetic("2 + 3 * 4")?.value).toBe(14);
  });

  it("handles parentheses, division and exponent together", () => {
    expect(evalArithmetic("(144/12)+7^2=?")?.value).toBe(61);
    expect(evalArithmetic("2^10")?.value).toBe(1024);
  });

  it("^ is right-associative", () => {
    expect(evalArithmetic("2^3^2")?.value).toBe(512); // 2^(3^2)=2^9
  });

  it("handles unary minus, modulo and the ×/÷ glyphs", () => {
    expect(evalArithmetic("-5 + 8")?.value).toBe(3);
    expect(evalArithmetic("17 % 5")?.value).toBe(2);
    expect(evalArithmetic("6 × 7")?.value).toBe(42);
    expect(evalArithmetic("84 ÷ 4")?.value).toBe(21);
  });

  it("kills floating-point dust", () => {
    expect(evalArithmetic("0.1 + 0.2")?.value).toBe(0.3);
  });

  it("strips TR/EN wrapper words around a bare calculation", () => {
    expect(evalArithmetic("2+2 kaç eder?")?.value).toBe(4);
    expect(evalArithmetic("what is 6*7")?.value).toBe(42);
    expect(evalArithmetic("hesapla 100/4")?.value).toBe(25);
  });

  it("returns null for non-arithmetic questions (no false positives)", () => {
    expect(evalArithmetic("Türkiye'nin başkenti?")).toBeNull();
    expect(evalArithmetic("print(sum(range(5)))")).toBeNull();
    expect(evalArithmetic("hello")).toBeNull();
    expect(evalArithmetic("")).toBeNull();
    expect(evalArithmetic("2 apples + 2")).toBeNull(); // letters present
  });

  it("rejects malformed / unsafe expressions instead of guessing", () => {
    expect(evalArithmetic("2 +")).toBeNull();
    expect(evalArithmetic("(2+3")).toBeNull();
    expect(evalArithmetic("2 2")).toBeNull();
    expect(evalArithmetic("5/0")).toBeNull();
  });

  it("formats a definitive statement", () => {
    expect(formatCertain({ expr: "2+2", value: 4 })).toBe("2+2 = 4");
  });
});

describe("certainty — stripThink", () => {
  it("removes a closed <think> block and keeps the answer", () => {
    const s = stripThink("<think>let me compute 2+2</think>The answer is 4.");
    expect(s.visible).toBe("The answer is 4.");
    expect(s.reasoning).toContain("2+2");
  });

  it("hides an unclosed <think> (mid-stream)", () => {
    const s = stripThink("Ankara.<think>wait, is it Istanbul? no, Ankara");
    expect(s.visible).toBe("Ankara.");
    expect(s.reasoning).toContain("Istanbul");
  });

  it("passes through clean text untouched", () => {
    const s = stripThink("The capital of Turkey is Ankara.");
    expect(s.visible).toBe("The capital of Turkey is Ankara.");
    expect(s.reasoning).toBe("");
  });
});
