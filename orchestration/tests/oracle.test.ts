// bin/oracle.ts'in önüne geçtiği saf karar mantığı: verify() TRUE/FALSE/UNDECIDABLE
// (CLI'nin kullandığı yol; network/daemon/subprocess'siz saf kategoriler test edilir).
import { describe, it, expect } from "vitest";
import { verify, classify, evalArithmetic, clearMemo, memoSize } from "../oracle/index";

describe("verify — arithmetic (tam-kesin rational)", () => {
  it("2+2=4 → TRUE (analytic)", () => {
    const r = verify("2+2=4");
    expect(r.verdict).toBe("TRUE");
    expect(r.category).toBe("arithmetic");
    expect(r.basis).toMatch(/analytic/);
  });
  it("2+2=5 → FALSE", () => {
    expect(verify("2+2=5").verdict).toBe("FALSE");
  });
  it("0.1+0.2=0.3 → TRUE (float değil, rational)", () => {
    expect(verify("0.1+0.2=0.3").verdict).toBe("TRUE");
  });
  it("bağıntısız ifade (2+2) → UNDECIDABLE (no-relation)", () => {
    const r = evalArithmetic("2+2");
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.basis).toBe("no-relation");
    expect(r.proof).toMatch(/4/); // değer yine hesaplanır
  });
});

describe("verify — ordering (ardıl)", () => {
  it("2'den sonra 3 gelir → TRUE", () => {
    const r = verify("2'den sonra 3 gelir");
    expect(r.verdict).toBe("TRUE");
    expect(r.category).toBe("ordering");
  });
  it("after 5 comes 7 → FALSE (ardıl 6)", () => {
    const r = verify("after 5 comes 7");
    expect(r.verdict).toBe("FALSE");
    expect(r.proof).toMatch(/6/);
  });
});

describe("verify — propositional logic (cdcl)", () => {
  it("A and not A is always false → TRUE (çelişki)", () => {
    const r = verify("A and not A is always false");
    expect(r.verdict).toBe("TRUE");
    expect(r.category).toBe("logic");
  });
  it("A or B is always true → FALSE + karşı-örnek kanıtı", () => {
    const r = verify("A or B is always true");
    expect(r.verdict).toBe("FALSE");
    expect(r.proof).toMatch(/karşı-örnek/);
  });
});

describe("verify — code-rule (CWE statik, exec'siz)", () => {
  it("SQL string-concat → FALSE (CWE-89)", () => {
    const r = verify({ kind: "code-rule", code: "db.query(`SELECT * FROM users WHERE id = ${userId}`)" });
    expect(r.verdict).toBe("FALSE");
    expect(r.basis).toBe("CWE-89");
  });
  it("parametreli sorgu → TRUE (tanınan güvenli kalıp)", () => {
    const r = verify({ kind: "code-rule", code: `db.execute("SELECT * FROM users WHERE id = ?", [userId])` });
    expect(r.verdict).toBe("TRUE");
    expect(r.basis).toBe("recognized-safe-pattern");
  });
  it("kalıpsız kod → UNDECIDABLE (yokluk ≠ doğruluk kanıtı)", () => {
    expect(verify({ kind: "code-rule", code: "const x = 1;" }).verdict).toBe("UNDECIDABLE");
  });
});

describe("verify — subjective / out-of-scope → UNDECIDABLE", () => {
  it("değer yargısı asla TRUE/FALSE almaz", () => {
    const r = verify("chocolate is better than vanilla");
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.category).toBe("subjective");
    expect(r.basis).toBe("value-judgment");
  });
  it("gelecek-olumsal → UNDECIDABLE (future-contingent)", () => {
    expect(verify("yarın yağmur olacak").basis).toBe("future-contingent");
  });
  it("kapsam-dışı serbest metin → UNDECIDABLE (unknown/out-of-scope)", () => {
    const r = verify("the sky contains birds sometimes");
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.category).toBe("unknown");
    expect(r.basis).toBe("out-of-scope");
  });
});

describe("classify + memo — dispatcher yardımcıları", () => {
  it("classify kategorileri doğru kovalara ayırır", () => {
    expect(classify("3 < 5")).toBe("arithmetic");
    expect(classify("after 1 comes 2")).toBe("ordering");
    expect(classify("A and B is always true")).toBe("logic");
    expect(classify("this is the best")).toBe("subjective");
  });
  it("verify memoize eder; whitespace-normalize aynı anahtara düşer", () => {
    clearMemo();
    expect(memoSize()).toBe(0);
    const a = verify("7*6=42");
    const b = verify("  7*6=42\n"); // trim + whitespace-normalize aynı anahtar
    expect(memoSize()).toBe(1);
    expect(b).toEqual(a);
    expect(a.verdict).toBe("TRUE");
  });
});
