import { describe, it, expect } from "vitest";
import { classifyQuestion, evalArithmetic, normalizeArithmetic, checkHtml, renderVerdict } from "../bin/lib/answer";

describe("the canonical requirement: 2+2=? answers DEFINITIVELY 4", () => {
  it("2+2=? → exactly 4, computed, no hedging", () => {
    const v = evalArithmetic("2+2=?");
    expect(v.definitive).toBe(true);
    expect(v.answer).toBe("4");
    expect(v.method).toBe("computed");
    expect(renderVerdict(v)).toContain("✅ 4 — DEFINITIVE (computed)");
    expect(renderVerdict(v)).not.toMatch(/maybe|belki|olabilir|probably/i);
  });
});

describe("arithmetic evaluator (computed, never recalled)", () => {
  const cases: Array<[string, string]> = [
    ["2+2", "4"],
    ["2+3*4", "14"],            // precedence
    ["(2+3)*4", "20"],          // parens
    ["10/4", "2.5"],
    ["2^10", "1024"],           // right-assoc power
    ["2^3^2", "512"],
    ["-5+3", "-2"],             // unary minus
    ["100-7*7", "51"],
    ["0.1+0.2", "0.3"],         // rounded to 1e-12 — no float noise in the answer
  ];
  for (const [q, want] of cases) {
    it(`${q} = ${want}`, () => {
      const v = evalArithmetic(q);
      expect(v.definitive, v.evidence).toBe(true);
      expect(v.answer).toBe(want);
    });
  }
  it("normalization strips '=?' dressing", () => {
    expect(normalizeArithmetic(" 7*6 = ? ")).toBe("7*6");
  });
});

describe("honest refusal (UNVERIFIED — never a guess)", () => {
  it("division by zero → refusal with the exact reason", () => {
    const v = evalArithmetic("1/0");
    expect(v.definitive).toBe(false);
    expect(v.answer).toBeUndefined();
    expect(v.evidence).toContain("division by zero");
    expect(renderVerdict(v)).toContain("refusing to guess");
  });
  it("malformed expression → refusal with parser position, no candidate answers", () => {
    const v = evalArithmetic("2++*3");
    expect(v.definitive).toBe(false);
    expect(v.evidence).toMatch(/expected a number|unexpected/);
  });
  it("trailing garbage → refusal (no partial-answer guessing)", () => {
    expect(evalArithmetic("2+2 elma").definitive).toBe(false);
  });
});

describe("classification (mechanical, fallback=fact which then REQUIRES a source)", () => {
  it("routes each kind correctly", () => {
    expect(classifyQuestion("2+2=?")).toBe("arithmetic");
    expect(classifyQuestion("print(2+2)")).toBe("python");
    expect(classifyQuestion("console.log(2+2)")).toBe("javascript");
    expect(classifyQuestion("<div><p>hi</p></div>")).toBe("html");
    expect(classifyQuestion("TypeScript hangi yıl çıktı?")).toBe("fact");
  });
});

describe("HTML5 structure check (validated, honest scope)", () => {
  it("balanced document → DEFINITIVE well-formed", () => {
    const v = checkHtml("<!doctype html><div><p>hi<br></p><img src='x'></div>");
    expect(v.definitive).toBe(true);
    expect(v.answer).toBe("well-formed");
    expect(v.evidence).toContain("balanced");
  });
  it("unclosed tag → UNVERIFIED naming the tag", () => {
    const v = checkHtml("<div><p>hi</div>");
    expect(v.definitive).toBe(false);
    expect(v.evidence).toContain("</div>");
  });
  it("mismatched close → UNVERIFIED", () => {
    expect(checkHtml("<div><span></div></span>").definitive).toBe(false);
  });
});

// ── research-until-verified core (answer-research.ts) ──────────────────────────
import { extractKeyFact, corroborate, renderImpasse } from "../bin/lib/answer-research";

describe("research corroboration (it is either right or wrong)", () => {
  it("extractKeyFact: number wins; normalization makes phrasings agree", () => {
    expect(extractKeyFact("2012 – Microsoft released TypeScript.")).toBe("2012");
    expect(extractKeyFact("In 2012, it shipped.")).toBe("2012");
    expect(extractKeyFact("")).toBeNull();
  });
  it("one channel = candidate, never an answer", () => {
    const c = corroborate([{ channel: "a", text: "2012", ok: true }]);
    expect(c.agreed).toBeNull();
    expect(c.votes[0]).toMatchObject({ fact: "2012" });
  });
  it("two INDEPENDENT channels agreeing → DEFINITIVE fact", () => {
    const c = corroborate([
      { channel: "odysseus-research", text: "2012 — official site", ok: true },
      { channel: "cloud:groq", text: "It was 2012 (Wikipedia).", ok: true },
    ]);
    expect(c.agreed).toBe("2012");
    expect(c.votes[0].channels).toEqual(["cloud:groq", "odysseus-research"]);
  });
  it("same channel twice does NOT corroborate (independence required)", () => {
    const c = corroborate([
      { channel: "cloud:groq", text: "2012", ok: true },
      { channel: "cloud:groq", text: "2012", ok: true },
    ]);
    expect(c.agreed).toBeNull();
  });
  it("conflict → no agreement; impasse names every candidate honestly", () => {
    const c = corroborate([
      { channel: "a", text: "2012", ok: true },
      { channel: "b", text: "2010", ok: true },
    ]);
    expect(c.agreed).toBeNull();
    const msg = renderImpasse(c.votes, 2);
    expect(msg).toContain('"2012" (a)');
    expect(msg).toContain('"2010" (b)');
  });
  it("failed channels are ignored, not counted as votes", () => {
    const c = corroborate([
      { channel: "a", text: "timeout", ok: false },
      { channel: "b", text: "2012", ok: true },
      { channel: "c", text: "2012!", ok: true },
    ]);
    expect(c.agreed).toBe("2012");
  });
});
