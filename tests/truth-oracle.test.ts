// Güven testleri — Deterministik Doğruluk Oracle'ı (orchestration/oracle).
// "Evrensel doğru/yanlış" kıstasının HATASIZ geçmesi gereken çekirdek vakaları.
// Hermetik: code-functional vakaları JS ile koşar (node her yerde var; python gerektirmez).

import { describe, test, expect } from "vitest";
import { verify, verifyMany, clearMemo, memoSize } from "../orchestration/oracle/index";
import { classifyFormula, classifyFormulaBrute, parseFormula, evalAst } from "../orchestration/oracle/logic";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Case = { name: string; input: Parameters<typeof verify>[0]; expect: "TRUE" | "FALSE" | "UNDECIDABLE"; proofIncludes?: string };

const BUGGY_FACTORIAL_JS = `function factorial(n){ let result=1; for(let i=1;i<n;i++){ result*=i; } return result; }`;
const CORRECT_FACTORIAL_JS = `function factorial(n){ let result=1; for(let i=2;i<=n;i++){ result*=i; } return result; }`;

const CASES: Case[] = [
  // ── arithmetic: TRUE ──
  { name: "2+2=4", input: "2+2=4", expect: "TRUE" },
  { name: "10/2=5", input: "10/2=5", expect: "TRUE" },
  { name: "2**10=1024", input: "2**10=1024", expect: "TRUE" },
  { name: "(2+3)*4=20", input: "(2+3)*4=20", expect: "TRUE" },
  { name: "7%3=1", input: "7%3=1", expect: "TRUE" },
  { name: "exact 0.1+0.2=0.3 (rational)", input: "0.1+0.2=0.3", expect: "TRUE" },
  { name: "2<3", input: "2<3", expect: "TRUE" },
  { name: "5>=5", input: "5>=5", expect: "TRUE" },
  { name: "10-3*2=4", input: "10-3*2=4", expect: "TRUE" },
  // ── arithmetic: FALSE ──
  { name: "2+2=5", input: "2+2=5", expect: "FALSE", proofIncludes: "4" },
  { name: "2*2=5", input: "2*2=5", expect: "FALSE" },
  { name: "3<2", input: "3<2", expect: "FALSE" },
  { name: "1/3=0.33 (rational ≠)", input: "1/3=0.33", expect: "FALSE" },
  { name: "0.1+0.2=0.30001", input: "0.1+0.2=0.30001", expect: "FALSE" },

  // ── ordering / successor ──
  { name: "TR: 2'den sonra 3 gelir", input: "2'den sonra 3 gelir", expect: "TRUE" },
  { name: "EN: after 9 comes 10", input: "after 9 comes 10", expect: "TRUE" },
  { name: "successor of 41 is 42", input: "successor of 41 is 42", expect: "TRUE" },
  { name: "TR yanlış: 2'den sonra 4 gelir", input: "2'den sonra 4 gelir", expect: "FALSE" },
  { name: "EN yanlış: after 9 comes 11", input: "after 9 comes 11", expect: "FALSE" },

  // ── propositional logic ──
  { name: "A or not A is always true (totoloji)", input: "A or not A is always true", expect: "TRUE" },
  { name: "A and not A is always false (çelişki)", input: "A and not A is always false", expect: "TRUE" },
  { name: "contrapositive totoloji", input: "(A implies B) iff (not B implies not A) is always true", expect: "TRUE" },
  { name: "yanlış: A or not A is always false", input: "A or not A is always false", expect: "FALSE" },
  { name: "yanlış: A and B is always true", input: "A and B is always true", expect: "FALSE" },

  // ── code-functional: DÜŞMANCA factorial (gerçek bug = off-by-one, parantez DEĞİL) ──
  { name: "buggy factorial → FALSE (counterexample n=5)", expect: "FALSE", proofIncludes: "120",
    input: { kind: "code-functional", lang: "js", entry: "factorial", code: BUGGY_FACTORIAL_JS,
      cases: [{ args: [5], expect: 120 }, { args: [3], expect: 6 }] } },
  { name: "correct factorial → TRUE", expect: "TRUE",
    input: { kind: "code-functional", lang: "js", entry: "factorial", code: CORRECT_FACTORIAL_JS,
      cases: [{ args: [0], expect: 1 }, { args: [1], expect: 1 }, { args: [3], expect: 6 }, { args: [5], expect: 120 }] } },

  // ── code-rule: nesnel anti-pattern (FALSE) vs doğru yöntem (TRUE) ──
  { name: "SQL string-concat → FALSE (CWE-89)", expect: "FALSE", proofIncludes: "CWE-89",
    input: { kind: "code-rule", code: `query = "SELECT * FROM users WHERE name = '" + name + "'"` } },
  { name: "eval(dynamic) → FALSE (CWE-95)", expect: "FALSE", proofIncludes: "CWE-95",
    input: { kind: "code-rule", code: `result = eval(user_input)` } },
  { name: "except: pass → FALSE (CWE-703)", expect: "FALSE",
    input: { kind: "code-rule", code: `try:\n    risky()\nexcept Exception:\n    pass` } },
  { name: "parameterized query → TRUE", expect: "TRUE",
    input: { kind: "code-rule", code: `cur.execute("SELECT * FROM users WHERE name = ?", (name,))` } },
  // ── code-rule AST-lite precision + sağlam 3-yönlü semantik ──
  { name: "yorumdaki eval → FALSE DEĞİL (UNDECIDABLE)", expect: "UNDECIDABLE",
    input: { kind: "code-rule", code: `// const q = eval(userInput)` } },
  { name: "eval saf literal → FALSE DEĞİL (UNDECIDABLE)", expect: "UNDECIDABLE",
    input: { kind: "code-rule", code: `const r = eval("2+2")` } },
  { name: "concat'sız SQL literal → UNDECIDABLE (sahte-pozitif yok)", expect: "UNDECIDABLE",
    input: { kind: "code-rule", code: `const q = "SELECT * FROM users WHERE id = 5"` } },
  { name: "execFile arg-list → TRUE (doğru yöntem)", expect: "TRUE",
    input: { kind: "code-rule", code: `execFile("ls", [userArg], cb)` } },
  { name: "jenerik kod → UNDECIDABLE (sağlam abstain)", expect: "UNDECIDABLE",
    input: { kind: "code-rule", code: `const x = 1 + 2; console.log(x)` } },

  // ── code-output: programı ÇALIŞTIR, stdout TAM-eşit (blob.includes substring'inden sıkı) ──
  { name: "code-output tam-eşit → TRUE", expect: "TRUE",
    input: { kind: "code-output", lang: "js", expect: "12586269025", code: `console.log(12586269025)` } },
  { name: "code-output yanlış değer → FALSE", expect: "FALSE",
    input: { kind: "code-output", lang: "js", expect: "12586269025", code: `console.log(42)` } },
  { name: "code-output substring-ama-tam-değil → FALSE (blob.includes geçerdi)", expect: "FALSE", proofIncludes: "TAM",
    input: { kind: "code-output", lang: "js", expect: "12586269025", code: `console.log("112586269025")` } },
  { name: "code-output son-satır eşleşmesi → TRUE", expect: "TRUE",
    input: { kind: "code-output", lang: "js", expect: "0.30", code: `console.log("debug"); console.log("0.30")` } },
  { name: "code-output çalışma hatası → FALSE", expect: "FALSE",
    input: { kind: "code-output", lang: "js", expect: "5", code: `throw new Error("boom")` } },

  // ── subjective / undecidable: ASLA doğru/yanlış DEMEMELI ──
  { name: "öznel: chocolate is better", input: "chocolate is better than vanilla", expect: "UNDECIDABLE" },
  { name: "estetik: this is beautiful", input: "this painting is beautiful", expect: "UNDECIDABLE" },
  { name: "etik: stealing is wrong", input: "stealing is morally wrong", expect: "UNDECIDABLE" },
  { name: "gelecek: bitcoin will hit 100k next year", input: "bitcoin will hit 100k next year", expect: "UNDECIDABLE" },
  { name: "kapsam-dışı empirik: the cat is on the mat", input: "the cat is on the mat", expect: "UNDECIDABLE" },
];

describe("Truth Oracle — güven testleri (hatasız geçmeli)", () => {
  for (const c of CASES) {
    test(`${c.expect.padEnd(11)} ${c.name}`, () => {
      const r = verify(c.input);
      expect(r.verdict, `proof: ${r.proof}`).toBe(c.expect);
      expect(r.proof.length).toBeGreaterThan(0);
      if (c.proofIncludes) expect(r.proof).toContain(c.proofIncludes);
    });
  }

  test("DÜŞMANCA: factorial bug'ı SÖZDİZİMSEL değil MANTIKSAL (off-by-one) bulunur", () => {
    const r = verify({ kind: "code-functional", lang: "js", entry: "factorial", code: BUGGY_FACTORIAL_JS,
      cases: [{ args: [5], expect: 120 }] });
    expect(r.verdict).toBe("FALSE");
    expect(r.basis).toBe("executed-counterexample"); // "eksik parantez" gibi sözdizim hatası DEĞİL
    expect(r.proof).toMatch(/factorial\(5\)/);
  });

  test("öznel girdi için verdict ASLA TRUE/FALSE olamaz", () => {
    for (const claim of ["X is better", "it is beautiful", "you should do it", "ahlaki olarak doğru"]) {
      expect(verify(claim).verdict).toBe("UNDECIDABLE");
    }
  });
});

describe("runtime — memoizasyon + paralel batch (deterministik parite)", () => {
  test("memo: cached == taze, tüm vakalar", () => {
    clearMemo();
    for (const c of CASES) {
      const fresh = verify(c.input);   // hesaplar + cache'ler
      const cached = verify(c.input);  // cache'ten döner
      expect(cached).toEqual(fresh);
      expect(cached.verdict).toBe(c.expect);
    }
    expect(memoSize()).toBeGreaterThan(0);
  });

  // Parallel batch verify over all CASES; under full-suite CPU contention the
  // default 5s can be overrun (load-dependent flake). Headroom only — the parity
  // assertions (batch == sequential, verdicts match) are unchanged.
  test("verifyMany paritesi: batch (paralel) == sıralı verify", async () => {
    const inputs = CASES.map((c) => c.input);
    clearMemo(); const batch = await verifyMany(inputs);
    clearMemo(); const seq = inputs.map((i) => verify(i));
    expect(batch).toEqual(seq);
    expect(batch.map((r) => r.verdict)).toEqual(CASES.map((c) => c.expect));
  }, 30_000);

  test("dosya-hash cache geçersizleme: dosya değişince yeni verdict (bayat cache YOK)", () => {
    clearMemo();
    const f = join(mkdtempSync(join(tmpdir(), "oracle-cachetest-")), "p.mjs");
    writeFileSync(f, "console.log(41)");
    expect(verify({ kind: "code-output", lang: "js", file: f, expect: "42" }).verdict).toBe("FALSE");
    writeFileSync(f, "console.log(42)"); // dosya içeriği değişti
    expect(verify({ kind: "code-output", lang: "js", file: f, expect: "42" }).verdict).toBe("TRUE");
  });
});

describe("mantık motoru — DPLL (truth-table'a karşı diferansiyel + tanık + ölçek)", () => {
  // Deterministik LCG (Math.random YOK) → tekrarlanabilir rastgele formüller (≤5 değişken).
  let seed = 1234567;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const VARS = ["A", "B", "C", "D", "E"];
  const gen = (depth: number): string => {
    if (depth <= 0 || rng() < 0.32) return VARS[Math.floor(rng() * VARS.length)];
    if (rng() < 0.22) return `(not ${gen(depth - 1)})`;
    const op = ["and", "or", "implies", "iff"][Math.floor(rng() * 4)];
    return `(${gen(depth - 1)} ${op} ${gen(depth - 1)})`;
  };

  test("DPLL == truth-table: 250 rastgele formülde sınıf eşleşmesi", () => {
    for (let k = 0; k < 250; k++) {
      const f = gen(4);
      const dpll = classifyFormula(f);
      const brute = classifyFormulaBrute(f);
      expect(dpll.cls, `formül: ${f}`).toBe(brute.cls);
    }
  });

  test("tanık geçerliliği: dönen modeller formülü gerçekten doğru/yanlış yapar", () => {
    for (let k = 0; k < 250; k++) {
      const f = gen(4);
      const ast = parseFormula(f);
      const { modelTrue, modelFalse } = classifyFormula(f);
      if (modelTrue) expect(evalAst(ast, modelTrue), `modelTrue formülü doğru yapmalı: ${f}`).toBe(true);
      if (modelFalse) expect(evalAst(ast, modelFalse), `modelFalse formülü yanlış yapmalı: ${f}`).toBe(false);
    }
  });

  test("bilinen vakalar: totoloji/çelişki/olumsal", () => {
    expect(classifyFormula("A or not A").cls).toBe("tautology");
    expect(classifyFormula("A and not A").cls).toBe("contradiction");
    expect(classifyFormula("(A implies B) iff (not B implies not A)").cls).toBe("tautology"); // kontrapozitif
    expect(classifyFormula("A and B").cls).toBe("contingent");
    expect(classifyFormula("(A or B) and (not A) and (not B)").cls).toBe("contradiction");
  });

  const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

  test("ÖLÇEK: 25 değişkenli formül DPLL ile anında (truth-table 2^25 infeasible)", () => {
    const taut25 = letters(25).map((c) => `${c} or not ${c}`).join(" or ");
    const contra25 = letters(25).map((c) => `${c} and not ${c}`).join(" and ");
    expect(() => classifyFormulaBrute(taut25)).toThrow();          // truth-table 2^25'i reddeder
    expect(classifyFormula(taut25).cls).toBe("tautology");         // DPLL anında
    expect(classifyFormula(contra25).cls).toBe("contradiction");   // DPLL anında (unit-prop)
  });

  // PERF/stress: ~0.8s alone but 2^18 brute-fallback thrashes under a saturated box (was 140s in
  // the commit gate). It's a stress proof, not a fast-gate test → PERF-only (CI). Run: PERF=1 vitest.
  // gated: PERF=1 — heavy adversarial-UNSAT budget-overflow perf case (slow; excluded from the default fast suite).
  test.skipIf(!process.env.PERF)("ROBUSTLUK: adversaryel UNSAT → bütçe aşımı → brute fallback (kesin, asılma yok)", () => {
    // ⋁(Xᵢ∧¬Xᵢ) plain-DPLL için patolojik; 18 değişken → DPLL bütçe aşar → ≤22 brute fallback → kesin sonuç.
    const hard = letters(18).map((c) => `(${c} and not ${c})`).join(" or ");
    expect(classifyFormula(hard, "dpll").cls).toBe("contradiction");
  }, 15000);
});

describe("CDCL SAT motoru — diferansiyel + tanık determinizmi + 135s→ms + sağlamlık", () => {
  let seed = 99887766;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const VARS = ["A", "B", "C", "D", "E"];
  const gen = (d: number): string => {
    if (d <= 0 || rng() < 0.32) return VARS[Math.floor(rng() * VARS.length)];
    if (rng() < 0.22) return `(not ${gen(d - 1)})`;
    const op = ["and", "or", "implies", "iff"][Math.floor(rng() * 4)];
    return `(${gen(d - 1)} ${op} ${gen(d - 1)})`;
  };
  const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

  test("CDCL == truth-table: 600 rastgele formülde sınıf eşleşmesi", () => {
    for (let k = 0; k < 600; k++) {
      const f = gen(4);
      expect(classifyFormula(f, "cdcl").cls, `formül: ${f}`).toBe(classifyFormulaBrute(f).cls);
    }
  });

  test("CDCL == DPLL: aynı sınıf (üç motor tutarlı)", () => {
    for (let k = 0; k < 300; k++) {
      const f = gen(4);
      expect(classifyFormula(f, "cdcl").cls).toBe(classifyFormula(f, "dpll").cls);
    }
  });

  test("CDCL tanık determinizmi: aynı formül iki çağrıda özdeş model", () => {
    for (let k = 0; k < 300; k++) {
      const f = gen(4);
      const a = classifyFormula(f, "cdcl");
      const b = classifyFormula(f, "cdcl");
      expect(a).toEqual(b); // modelTrue/modelFalse byte-eşdeğeri (memoizasyonsuz, saf)
    }
  });

  test("CDCL tanık geçerliliği: modeller formülü gerçekten doğru/yanlış yapar", () => {
    for (let k = 0; k < 300; k++) {
      const f = gen(4);
      const ast = parseFormula(f);
      const { modelTrue, modelFalse } = classifyFormula(f, "cdcl");
      if (modelTrue) expect(evalAst(ast, modelTrue)).toBe(true);
      if (modelFalse) expect(evalAst(ast, modelFalse)).toBe(false);
    }
  });

  // PERF: wall-clock assertion (flaky under a saturated box) → PERF-only. The correctness of this
  // case is already covered by the non-timed CDCL==brute differential test above.
  // gated: PERF=1 — heavy CDCL headline perf case (slow; excluded from the default fast suite).
  test.skipIf(!process.env.PERF)("HEADLINE: ⋁(Xᵢ∧¬Xᵢ)@25 CDCL ile ANINDA (plain-DPLL'de 135s idi)", () => {
    const orContra25 = letters(25).map((c) => `(${c} and not ${c})`).join(" or ");
    const t0 = Date.now();
    expect(classifyFormula(orContra25, "cdcl").cls).toBe("contradiction");
    expect(Date.now() - t0).toBeLessThan(2000); // saniyeler değil, ms
  });

  test("ölçek + hard: taut/contra@25 ve pigeonhole PHP(5,4) çelişki", () => {
    expect(classifyFormula(letters(25).map((c) => `${c} or not ${c}`).join(" or "), "cdcl").cls).toBe("tautology");
    expect(classifyFormula(letters(25).map((c) => `${c} and not ${c}`).join(" and "), "cdcl").cls).toBe("contradiction");
    // PHP(5,4): 5 güvercin, 4 delik → UNSAT (çelişki). Vars A..T (20).
    const V = (i: number, j: number) => String.fromCharCode(65 + i * 4 + j);
    const cl: string[] = [];
    for (let i = 0; i < 5; i++) cl.push("(" + [0, 1, 2, 3].map((j) => V(i, j)).join(" or ") + ")");
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) cl.push(`(not ${V(i, j)} or not ${V(k, j)})`);
    expect(classifyFormula(cl.join(" and "), "cdcl").cls).toBe("contradiction");
  }, 15000);

  test("SAĞLAMLIK: nondeterministik program → UNDECIDABLE (sessiz yanlış verdict yok)", () => {
    const r = verify({ kind: "code-output", lang: "js", expect: "0.5", code: `console.log(Math.random())` });
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.basis).toBe("nondeterministic");
  });

  test("SAĞLAMLIK: dev üs → resource-bound UNDECIDABLE (hang/OOM yok)", () => {
    const r = verify("2**999999 = 5");
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.basis).toBe("resource-bound");
  });
});
