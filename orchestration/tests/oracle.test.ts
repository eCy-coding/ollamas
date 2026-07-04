// bin/oracle.ts contract tests — the CLI is a thin wrapper over oracle/index verify() plus two inline
// helpers now extracted to bin/lib/oracle-lib.ts (render + verdictExitCode). Synthetic tasks below cover
// every verdict path the CLI can print/exit with. Deterministic; code-functional cases run one-shot
// node subprocesses (5s-capped by the oracle itself, no daemons).
import { describe, it, expect } from "vitest";
import { verify } from "../oracle/index";
import { render, verdictExitCode } from "../bin/lib/oracle-lib";

describe("verify — synthetic claims (the CLI's positional-arg path)", () => {
  it("true arithmetic → TRUE with exact-rational proof", () => {
    const r = verify("2+2=4");
    expect(r.verdict).toBe("TRUE");
    expect(r.category).toBe("arithmetic");
  });

  it("false arithmetic → FALSE", () => {
    expect(verify("2+2=5").verdict).toBe("FALSE");
  });

  it("0.1+0.2=0.3 is TRUE (exact rational, no float lie)", () => {
    expect(verify("0.1+0.2=0.3").verdict).toBe("TRUE");
  });

  it("ordering (TR successor phrasing) → TRUE / FALSE", () => {
    expect(verify("2'den sonra 3 gelir").verdict).toBe("TRUE");
    expect(verify("after 2 comes 4").verdict).toBe("FALSE");
  });

  it("subjective claim → UNDECIDABLE (never invents a truth value)", () => {
    const r = verify("chocolate is better than vanilla");
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.category).toBe("subjective");
  });

  it("out-of-scope prose → UNDECIDABLE/unknown", () => {
    const r = verify("the sky contains birds sometimes");
    expect(r.verdict).toBe("UNDECIDABLE");
  });
});

describe("verify — code requests (the CLI's --request path)", () => {
  it("correct JS function passes all cases → TRUE", () => {
    const r = verify({
      kind: "code-functional", lang: "js", entry: "add",
      code: "function add(a, b) { return a + b; }",
      cases: [{ args: [2, 3], expect: 5 }, { args: [-1, 1], expect: 0 }],
    });
    expect(r.verdict).toBe("TRUE");
    expect(r.basis).toBe("executed-all-pass");
  });

  it("buggy JS function → FALSE with an executed counterexample", () => {
    const r = verify({
      kind: "code-functional", lang: "js", entry: "add",
      code: "function add(a, b) { return a - b; }",
      cases: [{ args: [2, 3], expect: 5 }],
    });
    expect(r.verdict).toBe("FALSE");
    expect(r.basis).toBe("executed-counterexample");
  });

  it("code-rule: SQL quote-embedded concat → FALSE (CWE-89); parameterized query → TRUE", () => {
    const bad = verify({ kind: "code-rule", code: `db.query("SELECT * FROM users WHERE name = '" + name + "'");` });
    expect(bad.verdict).toBe("FALSE");
    expect(bad.basis).toBe("CWE-89");
    const good = verify({ kind: "code-rule", code: `db.query("SELECT * FROM users WHERE id = ?", [userId]);` });
    expect(good.verdict).toBe("TRUE");
  });
});

describe("render — the CLI's human output", () => {
  it("marks each verdict distinctly and carries category/basis/proof", () => {
    const t = render({ verdict: "TRUE", category: "arithmetic", basis: "analytic", proof: "P1" });
    const f = render({ verdict: "FALSE", category: "arithmetic", basis: "analytic", proof: "P2" });
    const u = render({ verdict: "UNDECIDABLE", category: "subjective", basis: "value-judgment", proof: "P3" });
    expect(t).toContain("✓ DOĞRU");
    expect(f).toContain("✗ YANLIŞ");
    expect(u).toContain("○ KARARSIZ");
    expect(t).toContain("[arithmetic · analytic]");
    expect(t).toContain("P1");
  });
});

describe("verdictExitCode — conduct-gate compatible exit mapping", () => {
  it("TRUE=0, FALSE=1, UNDECIDABLE=3", () => {
    expect(verdictExitCode("TRUE")).toBe(0);
    expect(verdictExitCode("FALSE")).toBe(1);
    expect(verdictExitCode("UNDECIDABLE")).toBe(3);
  });
});
