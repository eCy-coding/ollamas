/**
 * orchestration/oracle/index.ts — Deterministik Doğruluk Oracle'ı (Truth Oracle).
 *
 * Evrensel/nesnel doğru-yanlışı GÖRÜŞLE değil HESAPLAYARAK/ÇALIŞTIRARAK karara bağlar.
 * Bir LLM oracle DEĞİLDİR (halüsinasyon yapar); bu modül yer-gerçeğini deterministik üretir:
 *   - matematik/mantık  → tam-kesin (Rational/truth-table) hesap
 *   - kod               → gerçekten ÇALIŞTIRIP referansla karşılaştırma (counterexample)
 *   - nesnel anti-pattern → CWE dayanaklı statik tespit
 *   - öznel/etik/estetik → UNDECIDABLE (asla doğru/yanlış uydurmaz — güvenin özü)
 *
 * Kaynak: analitik–sentetik ayrımı (zorunlu doğru = hesaplanabilir); test-oracle problemi
 * (güvenilir oracle deterministiktir). Bkz. orchestration/TRUTH.md.
 *
 * Çalıştır:  tsx orchestration/bin/oracle.ts "2+2=4"
 */
import { execFileSync, execFile } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { classifyFormula, type LogicClass, type Assignment } from "./logic";

const execFileP = promisify(execFile);

export type Verdict = "TRUE" | "FALSE" | "UNDECIDABLE";
export type Category =
  | "arithmetic"
  | "ordering"
  | "logic"
  | "code-functional"
  | "code-output"
  | "code-rule"
  | "subjective"
  | "unknown";

export interface OracleResult {
  verdict: Verdict;
  category: Category;
  /** İnsan-okur kanıt: hesap sonucu / karşı-örnek / kural-ihlali / "öznel" gerekçesi. */
  proof: string;
  /** Doğruluğun dayanağı: "analytic", "executed-counterexample", "CWE-89", vb. */
  basis: string;
}

// ───────────────────────────── Rational (tam-kesin aritmetik) ─────────────────────────────
// Float kullanmaz: 0.1+0.2 == 0.3 MATEMATİKSEL olarak doğru karara bağlanır.

function bgcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a || 1n;
}

class Rational {
  n: bigint; // pay (işaret burada)
  d: bigint; // payda (> 0)
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error("sıfıra bölme");
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static fromDecimal(s: string): Rational {
    // "12", "12.34", ".5", "-3.0"
    const neg = s.startsWith("-");
    if (neg) s = s.slice(1);
    const [int, frac = ""] = s.split(".");
    const num = BigInt((int || "0") + frac);
    const den = 10n ** BigInt(frac.length);
    return new Rational(neg ? -num : num, den);
  }
  add(o: Rational) { return new Rational(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Rational) { return new Rational(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Rational) { return new Rational(this.n * o.n, this.d * o.d); }
  div(o: Rational) { if (o.n === 0n) throw new Error("sıfıra bölme"); return new Rational(this.n * o.d, this.d * o.n); }
  powInt(e: bigint): Rational {
    if (e < 0n) return new Rational(this.d ** -e, this.n ** -e);
    return new Rational(this.n ** e, this.d ** e);
  }
  floor(): bigint {
    // floor(n/d), d>0
    const q = this.n / this.d;
    const r = this.n % this.d;
    return r !== 0n && this.n < 0n ? q - 1n : q;
  }
  floordiv(o: Rational): Rational { return new Rational(this.div(o).floor(), 1n); }
  mod(o: Rational): Rational { return this.sub(this.floordiv(o).mul(o)); }
  cmp(o: Rational): number {
    const l = this.n * o.d, r = o.n * this.d; // d'ler > 0
    return l < r ? -1 : l > r ? 1 : 0;
  }
  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }
}

// ───────────────────────────── Aritmetik ayrıştırıcı (güvenli; eval YOK) ─────────────────────────────
// Grammar: relation := expr (relop expr)? ; expr := term (('+'|'-') term)* ;
// term := factor (('*'|'/'|'//'|'%') factor)* ; factor := unary ('**' factor)? ;
// unary := ('+'|'-')* base ; base := number | '(' expr ')'

type Tok = { t: "num"; v: Rational } | { t: "op"; v: string } | { t: "rel"; v: string };

function tokenizeArith(src: string): Tok[] {
  const s = src.replace(/\s+/g, "")
    .replace(/[×·]/g, "*").replace(/[÷]/g, "/")
    .replace(/≠/g, "!=").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/＝/g, "=");
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const lit = s.slice(i, j);
      if ((lit.match(/\./g) || []).length > 1) throw new Error("geçersiz sayı: " + lit);
      toks.push({ t: "num", v: Rational.fromDecimal(lit) });
      i = j; continue;
    }
    // çok-karakterli operatörler
    const three = s.slice(i, i + 2);
    if (three === "**" || three === "//") { toks.push({ t: "op", v: three }); i += 2; continue; }
    if (three === "==" ) { toks.push({ t: "rel", v: "==" }); i += 2; continue; }
    if (three === "!=" ) { toks.push({ t: "rel", v: "!=" }); i += 2; continue; }
    if (three === "<=" ) { toks.push({ t: "rel", v: "<=" }); i += 2; continue; }
    if (three === ">=" ) { toks.push({ t: "rel", v: ">=" }); i += 2; continue; }
    if ("+-*/%()".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "=") { toks.push({ t: "rel", v: "==" }); i++; continue; }
    if (c === "<" || c === ">") { toks.push({ t: "rel", v: c }); i++; continue; }
    throw new Error("geçersiz karakter: " + c);
  }
  return toks;
}

class ArithParser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.i]; }
  eat(): Tok { return this.toks[this.i++]; }
  expr(): Rational {
    let v = this.term();
    for (let p = this.peek(); p && p.t === "op" && (p.v === "+" || p.v === "-"); p = this.peek()) {
      this.eat(); const r = this.term(); v = p.v === "+" ? v.add(r) : v.sub(r);
    }
    return v;
  }
  term(): Rational {
    let v = this.factor();
    for (let p = this.peek(); p && p.t === "op" && ["*", "/", "//", "%"].includes(p.v); p = this.peek()) {
      this.eat(); const r = this.factor();
      v = p.v === "*" ? v.mul(r) : p.v === "/" ? v.div(r) : p.v === "//" ? v.floordiv(r) : v.mod(r);
    }
    return v;
  }
  factor(): Rational {
    const b = this.unary();
    const p = this.peek();
    if (p && p.t === "op" && p.v === "**") {
      this.eat();
      const e = this.factor();
      if (e.d !== 1n) throw new Error("üs tamsayı olmalı");
      // SAĞLAMLIK: dev üs/sonuç hang/OOM yapar → deterministik eşikte UNDECIDABLE'a düş
      const exp = e.n < 0n ? -e.n : e.n;
      const baseBits = BigInt(b.n.toString(2).length + b.d.toString(2).length);
      if (exp > 100000n || baseBits * exp > 1000000n) throw new Error("resource: üs/sonuç çok büyük");
      return b.powInt(e.n);
    }
    return b;
  }
  unary(): Rational {
    const p = this.peek();
    if (p && p.t === "op" && (p.v === "+" || p.v === "-")) {
      this.eat(); const v = this.unary();
      return p.v === "-" ? new Rational(-1n).mul(v) : v;
    }
    return this.base();
  }
  base(): Rational {
    const p = this.eat();
    if (!p) throw new Error("beklenmedik son");
    if (p.t === "num") return p.v;
    if (p.t === "op" && p.v === "(") {
      const v = this.expr();
      const c = this.eat();
      if (!c || c.t !== "op" || c.v !== ")") throw new Error("kapanmayan parantez");
      return v;
    }
    throw new Error("beklenmedik belirteç: " + JSON.stringify(p));
  }
}

/** "2+2=4" gibi bir aritmetik (in)eşitliği tam-kesin değerlendir. */
export function evalArithmetic(claim: string): OracleResult {
  const toks = tokenizeArith(claim);
  const relIdx = toks.findIndex((t) => t.t === "rel");
  if (relIdx < 0) {
    // bağıntı yok → tek ifade; doğru/yanlış değil, sadece değer → UNDECIDABLE
    const v = new ArithParser(toks).expr();
    return { verdict: "UNDECIDABLE", category: "arithmetic", basis: "no-relation",
      proof: `İfade bir önerme değil; değeri = ${v.toString()}. Doğru/yanlış için bir bağıntı (=, <, …) gerekir.` };
  }
  if (toks.filter((t) => t.t === "rel").length !== 1) {
    return { verdict: "UNDECIDABLE", category: "arithmetic", basis: "multi-relation",
      proof: "Birden fazla bağıntı; tek karşılaştırma desteklenir." };
  }
  const rel = (toks[relIdx] as { t: "rel"; v: string }).v;
  const lhs = new ArithParser(toks.slice(0, relIdx)).expr();
  const rhs = new ArithParser(toks.slice(relIdx + 1)).expr();
  const c = lhs.cmp(rhs);
  const holds =
    rel === "==" ? c === 0 :
    rel === "!=" ? c !== 0 :
    rel === "<"  ? c < 0 :
    rel === "<=" ? c <= 0 :
    rel === ">"  ? c > 0 :
    /* >= */       c >= 0;
  return {
    verdict: holds ? "TRUE" : "FALSE",
    category: "arithmetic",
    basis: "analytic (exact rational)",
    proof: `SOL = ${lhs.toString()}, SAĞ = ${rhs.toString()} ⇒ (${lhs.toString()} ${rel} ${rhs.toString()}) = ${holds}.`,
  };
}

// ───────────────────────────── Ordering / ardıl ─────────────────────────────
const ORDER_RE = [
  /(-?\d+)\s*(?:'?den|'?dan|'?ten|'?tan)?\s*sonra\s*(-?\d+)\s*gel/i, // TR: N'den sonra M gelir
  /after\s*(-?\d+)\s*(?:comes|is)\s*(-?\d+)/i,                        // EN: after N comes M
  /(?:successor|ardıl[ıi]?)\s*(?:of)?\s*(-?\d+)\s*(?:is|=|:)?\s*(-?\d+)/i,
  /(-?\d+)\s*is\s*followed\s*by\s*(-?\d+)/i,
];
export function evalOrdering(claim: string): OracleResult | null {
  for (const re of ORDER_RE) {
    const m = claim.match(re);
    if (m) {
      const n = BigInt(m[1]), got = BigInt(m[2]);
      const holds = got === n + 1n;
      return {
        verdict: holds ? "TRUE" : "FALSE",
        category: "ordering",
        basis: "successor (n+1)",
        proof: `ardıl(${n}) = ${n + 1n}; iddia edilen = ${got} ⇒ ${holds}.`,
      };
    }
  }
  return null;
}

// ───────────────────────────── Propositional logic ─────────────────────────────
// Mantık motoru ./logic.ts'e taşındı: DPLL (unit-prop + pure-literal + backtrack) + Tseitin CNF;
// truth-table korrektlik oracle'ı orada korunur. Buradan yalnız classifyFormula kullanılır.

const envStr = (e?: Assignment) =>
  e ? Object.entries(e).map(([k, v]) => `${k}=${v ? "T" : "F"}`).join(", ") : "";

/** "<formül> is always true/false" veya saf formül sınıflandırması. */
export function evalLogic(input: string): OracleResult | null {
  const alwaysTrue = /(always\s*true|tautolog|her\s*durumda\s*do[ğg]ru|geçerli)/i.test(input);
  const alwaysFalse = /(always\s*false|contradict|çeli[şs]ki|her\s*durumda\s*yanl[ıi][şs])/i.test(input);
  // formülü ayıkla: bilinen anahtar ifadeleri at, kalan mantık ifadesi
  const formula = input
    .replace(/(is\s*)?(always\s*true|always\s*false|a?\s*tautology|a?\s*contradiction)/ig, "")
    .replace(/(her\s*durumda\s*(do[ğg]ru|yanl[ıi][şs])|geçerli|çeli[şs]ki(dir)?)/ig, "")
    .replace(/["'?.]/g, "").trim();
  if (!alwaysTrue && !alwaysFalse) return null;
  let res: { cls: LogicClass; modelTrue?: Assignment; modelFalse?: Assignment };
  try { res = classifyFormula(formula); }
  catch { return null; }
  const { cls, modelTrue, modelFalse } = res;
  if (alwaysTrue) {
    const holds = cls === "tautology";
    return { verdict: holds ? "TRUE" : "FALSE", category: "logic", basis: "cdcl",
      proof: holds ? `"${formula}" bir totolojidir (¬F UNSAT — tüm atamalarda doğru).`
                   : `"${formula}" totoloji değil; karşı-örnek: ${envStr(modelFalse)} → yanlış.` };
  }
  // alwaysFalse
  const holds = cls === "contradiction";
  return { verdict: holds ? "TRUE" : "FALSE", category: "logic", basis: "cdcl",
    proof: holds ? `"${formula}" bir çelişkidir (F UNSAT — tüm atamalarda yanlış).`
                 : `"${formula}" çelişki değil; karşı-örnek: ${envStr(modelTrue)} → doğru.` };
}

/** Saf formül → sınıflandırma (CLI --logic). */
export function logicClassify(formula: string): OracleResult {
  const { cls, modelTrue, modelFalse } = classifyFormula(formula);
  return { verdict: cls === "contingent" ? "UNDECIDABLE" : "TRUE", category: "logic", basis: "cdcl",
    proof: cls === "tautology" ? "totoloji (her zaman doğru)"
         : cls === "contradiction" ? "çelişki (her zaman yanlış)"
         : `olumsal (duruma bağlı); örnek: ${envStr(modelFalse ?? modelTrue)}` };
}

// ───────────────────────────── Code: functional (çalıştır + karşılaştır) ─────────────────────────────
export interface CodeFnRequest {
  kind: "code-functional";
  lang: "python" | "js";
  code: string;
  entry: string;
  cases: { args: unknown[]; expect: unknown }[];
}

// Aday kod kendi stdout'unu basabilir; sonucu sentinel'la sarıp ayıklıyoruz ki JSON.parse kırılmasın.
const SENTINEL_RE = /__ORACLE_BEGIN__([\s\S]*?)__ORACLE_END__/;
function extractSentinel(out: string): string {
  const m = out.match(SENTINEL_RE);
  if (!m) throw new Error("oracle sentinel bulunamadı; ham çıktı: " + out.slice(0, 200));
  return m[1];
}

function runCases(req: CodeFnRequest): { args: unknown[]; ok: boolean; got?: unknown; err?: string }[] {
  const dir = mkdtempSync(join(tmpdir(), "oracle-"));
  try {
    if (req.lang === "js") {
      const file = join(dir, "cand.mjs");
      const harness = `${req.code}
const __cases = ${JSON.stringify(req.cases.map((c) => c.args))};
const __bi = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
const __r = __cases.map((a) => { try { return { ok: true, v: ${req.entry}(...a) }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } });
console.log("__ORACLE_BEGIN__" + JSON.stringify(__r, __bi) + "__ORACLE_END__");`;
      writeFileSync(file, harness);
      const out = execFileSync("node", [file], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], env: PINNED_ENV() });
      const parsed = JSON.parse(extractSentinel(out)) as { ok: boolean; v?: unknown; e?: string }[];
      return parsed.map((p, i) => ({ args: req.cases[i].args, ok: p.ok, got: p.v, err: p.e }));
    } else {
      const file = join(dir, "cand.py");
      const harness = `${req.code}
import json as __json
__cases = __json.loads(${JSON.stringify(JSON.stringify(req.cases.map((c) => c.args)))})
def __run(a):
    try:
        return {"ok": True, "v": ${req.entry}(*a)}
    except Exception as e:
        return {"ok": False, "e": str(e)}
print("__ORACLE_BEGIN__" + __json.dumps([__run(a) for a in __cases]) + "__ORACLE_END__")`;
      writeFileSync(file, harness);
      const out = execFileSync("python3", [file], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], env: PINNED_ENV() });
      const parsed = JSON.parse(extractSentinel(out)) as { ok: boolean; v?: unknown; e?: string }[];
      return parsed.map((p, i) => ({ args: req.cases[i].args, ok: p.ok, got: p.v, err: p.e }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const norm = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export function evalCodeFunctional(req: CodeFnRequest): OracleResult {
  let results;
  try { results = runCases(req); }
  catch (e) {
    return { verdict: "UNDECIDABLE", category: "code-functional", basis: "execution-error",
      proof: `Kod çalıştırılamadı (derleme/zaman aşımı): ${String((e as Error).message).slice(0, 200)}` };
  }
  if (DET_GATE) {
    let r2: typeof results | null;
    try { r2 = runCases(req); } catch { r2 = null; }
    const sig = (rs: typeof results | null) => (rs ? JSON.stringify(rs.map((r) => [r.ok, norm(r.got), r.err ?? null])) : "ERR");
    if (sig(results) !== sig(r2)) {
      return { verdict: "UNDECIDABLE", category: "code-functional", basis: "nondeterministic",
        proof: "Kod iki çalıştırmada FARKLI sonuç verdi — deterministik değil; sağlam doğru/yanlış verilemez." };
    }
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i], exp = req.cases[i].expect;
    if (!r.ok) {
      return { verdict: "FALSE", category: "code-functional", basis: "executed-counterexample",
        proof: `Girdi ${norm(r.args)} → HATA (${r.err}). Doğru bir uygulama ${norm(exp)} döndürmeliydi.` };
    }
    if (norm(r.got) !== norm(exp)) {
      return { verdict: "FALSE", category: "code-functional", basis: "executed-counterexample",
        proof: `Karşı-örnek: ${req.entry}(${(r.args as unknown[]).map(norm).join(", ")}) = ${norm(r.got)}, beklenen ${norm(exp)}.` };
    }
  }
  return { verdict: "TRUE", category: "code-functional", basis: "executed-all-pass",
    proof: `${results.length} vakanın tümü referans değerle eşleşti.` };
}

// ───────────────────────────── Code: output (programı çalıştır, stdout tam-eşit) ─────────────────────────────
// combo-bench tarzı: agent tek-cevap YAZDIRAN bir program yazar. blob.includes (substring) yerine
// programı ORACLE çalıştırır ve stdout'u TAM eşitlikle karşılaştırır (agent'ın iddiasına güvenmez).
export interface CodeOutputRequest {
  kind: "code-output";
  lang: "js" | "python";
  /** Çalıştırılacak mevcut dosya yolu; verilmezse `code` geçici dosyaya yazılır. */
  file?: string;
  code?: string;
  /** Beklenen tam stdout (trim'lenir). */
  expect: string;
}

const EXEC_TIMEOUT = 8000;
const rmDir = (dir?: string) => { if (dir) rmSync(dir, { recursive: true, force: true }); };

// SAĞLAMLIK KAPISI: subprocess env'ini çivile (locale/saat/hash sırası) + satır-sonu normalize +
// adayı İKİ KEZ çalıştırıp karşılaştır → farklıysa program nondeterministik → UNDECIDABLE
// (sessiz yanlış verdict yerine dürüst çekimser; makineler-arası determinizmi korur).
const PINNED_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: "C", LANG: "C", LC_NUMERIC: "C", TZ: "UTC", PYTHONHASHSEED: "0" });
const normNL = (s: string) => s.replace(/\r\n/g, "\n");
const DET_GATE = process.env.ORACLE_DETERMINISM_GATE !== "0"; // varsayılan AÇIK
const SYNC_OPTS = () => ({ encoding: "utf8" as const, timeout: EXEC_TIMEOUT, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], env: PINNED_ENV() });
function nondetOut(a: string, b: string): OracleResult {
  return { verdict: "UNDECIDABLE", category: "code-output", basis: "nondeterministic",
    proof: `Program iki çalıştırmada FARKLI çıktı verdi («${a.trim().slice(0, 50)}» vs «${b.trim().slice(0, 50)}») — deterministik değil; sağlam doğru/yanlış verilemez.` };
}

function prepOut(req: CodeOutputRequest): { bin: string; target: string; dir?: string } {
  const bin = req.lang === "js" ? "node" : "python3";
  if (req.file) return { bin, target: req.file };
  const dir = mkdtempSync(join(tmpdir(), "oracle-out-"));
  const target = join(dir, req.lang === "js" ? "prog.mjs" : "prog.py");
  writeFileSync(target, req.code ?? "");
  return { bin, target, dir };
}
function judgeOutOk(req: CodeOutputRequest, stdout: string): OracleResult {
  const trimmed = stdout.trim();
  const lastLine = trimmed.split(/\r?\n/).filter((l) => l.trim()).pop()?.trim() ?? "";
  const exp = req.expect.trim();
  const holds = trimmed === exp || lastLine === exp;
  return holds
    ? { verdict: "TRUE", category: "code-output", basis: "executed-output-exact",
        proof: `Çalıştırıldı; stdout «${trimmed.slice(0, 120)}» beklenen «${exp}» ile TAM eşleşti.` }
    : { verdict: "FALSE", category: "code-output", basis: "executed-output-exact",
        proof: `Çalıştırıldı; program «${trimmed.slice(0, 120)}» yazdırdı; beklenen TAM «${exp}» (substring değil, tam eşitlik).` };
}
function judgeOutErr(req: CodeOutputRequest, e: unknown): OracleResult {
  const err = e as { killed?: boolean; code?: string; stderr?: string; message?: string };
  if (err.killed || err.code === "ETIMEDOUT") {
    return { verdict: "UNDECIDABLE", category: "code-output", basis: "timeout",
      proof: "Program zaman aşımına uğradı (8s); çıktı belirlenemedi." };
  }
  // Deterministik kanıt: rastgele temp yolunu sızdırma, hata satırını (Error: ...) çıkar.
  const raw = String(err.stderr || err.message || "");
  const line = raw.match(/^[A-Za-z]*Error:.*$/m);
  const detail = (line ? line[0] : raw.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "runtime hatası").slice(0, 160);
  return { verdict: "FALSE", category: "code-output", basis: "executed-error",
    proof: `Program çalışırken hata verdi: ${detail}. Doğru program «${req.expect.trim()}» yazdırmalıydı.` };
}

// Sync ve async aynı prep+judge'i paylaşır; yalnız exec çağrısı farklı (her ikisi de TAZE izole subprocess).
export function evalCodeOutput(req: CodeOutputRequest): OracleResult {
  const { bin, target, dir } = prepOut(req);
  try {
    const out1 = normNL(execFileSync(bin, [target], SYNC_OPTS()));
    if (DET_GATE) {
      const out2 = normNL(execFileSync(bin, [target], SYNC_OPTS()));
      if (out1.trim() !== out2.trim()) { rmDir(dir); return nondetOut(out1, out2); }
    }
    rmDir(dir); return judgeOutOk(req, out1);
  } catch (e) { rmDir(dir); return judgeOutErr(req, e); }
}
async function evalCodeOutputAsync(req: CodeOutputRequest): Promise<OracleResult> {
  const { bin, target, dir } = prepOut(req);
  const opts = { encoding: "utf8" as const, timeout: EXEC_TIMEOUT, maxBuffer: 1 << 20, env: PINNED_ENV() };
  try {
    const out1 = normNL((await execFileP(bin, [target], opts)).stdout);
    if (DET_GATE) {
      const out2 = normNL((await execFileP(bin, [target], opts)).stdout);
      if (out1.trim() !== out2.trim()) { rmDir(dir); return nondetOut(out1, out2); }
    }
    rmDir(dir); return judgeOutOk(req, out1);
  } catch (e) { rmDir(dir); return judgeOutErr(req, e); }
}

// ───────────────────────────── Code: rule (CWE anti-pattern statik) ─────────────────────────────
export interface CodeRuleRequest { kind: "code-rule"; code: string; }
interface Rule { id: string; cwe: string; re: RegExp; msg: string; fix: string; }

const RULES: Rule[] = [
  { id: "sql-string-concat", cwe: "CWE-89",
    re: /(?:select|insert|update|delete)\b[^;'"]*?(?:["'`][^"'`]*["'`]\s*\+|\+\s*["'`]|\$\{|%\s*\(|%\s*[a-z_]|\.format\s*\(|f["'])/is,
    msg: "SQL sorgusu kullanıcı verisiyle string birleştirilerek/biçimlendirilerek kuruluyor (SQL injection).",
    fix: "Parametreli sorgu kullanın: placeholder (?, $1) + ayrı parametre dizisi." },
  { id: "eval-dynamic", cwe: "CWE-95",
    re: /\b(?:eval|exec)\s*\(\s*(?!["'`][^"'`]*["'`]\s*\))[A-Za-z_]/,
    msg: "Dinamik girdi eval()/exec() ile çalıştırılıyor (kod enjeksiyonu).",
    fix: "eval/exec kaldırın; güvenli ayrıştırıcı (ör. JSON.parse, ast.literal_eval) kullanın." },
  { id: "shell-injection", cwe: "CWE-78",
    re: /(?:os\.system\s*\(|subprocess\.[a-z]+\([^)]*shell\s*=\s*True|child_process\.(?:exec|execSync)\s*\()\s*[^)]*(?:\+|\$\{|f["']|%[ (s])/is,
    msg: "Kabuk komutu string-interpolasyonla kuruluyor (command injection).",
    fix: "Argüman dizisiyle çağırın: execFile / subprocess.run([...], shell=False)." },
  { id: "swallow-exception", cwe: "CWE-703",
    re: /except\s*(?:[A-Za-z_][\w.]*)?\s*:\s*\n?\s*pass\b/,
    msg: "İstisna sessizce yutuluyor (except: pass) — hatalar gizlenir.",
    fix: "İstisnayı loglayın/yeniden fırlatın; en azından bağlamı kaydedin." },
];

// AST-lite: eşleştirmeden önce yorumları çıkar → yorum/kapatılmış koddaki kalıplar yakalanmaz.
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")     // /* blok */
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")  // // satır (:// hariç)
    .replace(/(^|\s)#[^\n]*/g, "$1");      // # satır (python; this.#field hariç)
}

// Tanınan DOĞRU kalıplar — yöntem-doğruluğunun POZİTİF kanıtı.
const CORRECT: { id: string; re: RegExp; why: string }[] = [
  { id: "parameterized-query", re: /\.(?:execute|query|prepare)\s*\(\s*["'`][^"'`]*(?:\?|\$\d|%s|:\w)[^"'`]*["'`]\s*,/i,
    why: "parametreli sorgu (placeholder + ayrı parametreler) — SQL injection'a kapalı (CWE-89 doğru yöntemi)" },
  { id: "execfile-arglist", re: /\bexecFile(?:Sync)?\s*\(/,
    why: "execFile (argüman dizisi) — kabuk yorumlaması yok, command injection'a kapalı (CWE-78 doğru yöntemi)" },
  { id: "subprocess-list", re: /subprocess\.(?:run|call|Popen)\s*\(\s*\[/,
    why: "subprocess argüman listesiyle çağrılıyor — command injection'a kapalı (CWE-78 doğru yöntemi)" },
  { id: "shell-false", re: /shell\s*=\s*False/i,
    why: "subprocess shell=False — kabuk enjeksiyonuna kapalı" },
  { id: "with-resource", re: /\bwith\s+[A-Za-z_][\w.]*\s*\([^)]*\)\s*as\s+\w+/,
    why: "with / context-manager — kaynak güvenle açılıp kapatılır" },
];

export function evalCodeRule(req: CodeRuleRequest): OracleResult {
  const code = stripComments(req.code);
  // 1) yüksek-güven anti-pattern (sink + dinamik argüman) → YANLIŞ yöntem
  const findings: { rule: Rule; snippet: string }[] = [];
  for (const rule of RULES) {
    const m = code.match(rule.re);
    if (m && m.index !== undefined) findings.push({ rule, snippet: m[0].replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  if (findings.length) {
    const f = findings[0];
    const extra = findings.length > 1 ? ` (+${findings.length - 1} bulgu daha)` : "";
    return { verdict: "FALSE", category: "code-rule", basis: f.rule.cwe,
      proof: `[${f.rule.cwe}] ${f.rule.msg} İhlal: «${f.snippet}». Doğru yöntem: ${f.rule.fix}${extra}` };
  }
  // 2) tanınan DOĞRU kalıp → doğru yöntem
  for (const c of CORRECT) {
    if (c.re.test(code)) return { verdict: "TRUE", category: "code-rule", basis: "recognized-safe-pattern",
      proof: `Tanınan güvenli kalıp: ${c.why}.` };
  }
  // 3) ne biri ne diğeri → sağlam çekimser: kötü kalıbın YOKLUĞU yöntemin doğruluğunu KANITLAMAZ
  return { verdict: "UNDECIDABLE", category: "code-rule", basis: "no-known-pattern",
    proof: "Bu kodda bilinen nesnel YANLIŞ (CWE anti-pattern) ya da DOĞRU (parametreli/arg-list/with) kalıp yok; yöntem-doğruluğu sağlam kararlaştırılamaz." };
}

// ───────────────────────────── Subjective / undecidable ─────────────────────────────
// Türkçe sondan-eklemeli olduğu için sondaki \b kasıtlı olarak yok (ahlak→ahlaki eşleşsin).
// Gevşetme güvenli: aritmetik/sıra/mantık/kod ZATEN bundan önce değerlendirilir; bu yalnız
// "bilinmeyen" kovasını etkiler ve orada güvenli yanıt zaten UNDECIDABLE'dır.
const SUBJECTIVE_RE = /\b(better|best|worse|beautiful|ugly|good|bad|evil|nice|should|ought|prefer|favou?rite|tasty|fun|boring|moral|immoral|unethical|wrong|ethic|right\s+thing|daha\s+iyi|daha\s+kötü|güzel|çirkin|iyi\s+mi|kötü\s+mü|ahlak|etik|olmal|tercih|sevgi|nefret|en\s+iyi)/i;
const FUTURE_RE = /\b(will|gonna|tomorrow|next\s+year|yarın|gelecek\s+yıl|olacak|kazanacak)\b/i;

export function evalSubjective(claim: string): OracleResult | null {
  if (SUBJECTIVE_RE.test(claim)) {
    return { verdict: "UNDECIDABLE", category: "subjective", basis: "value-judgment",
      proof: "Değer/etik/estetik yargısı içeriyor — gözlemciden bağımsız hesapla kararlaştırılamaz; evrensel doğru/yanlış kapsamı dışında." };
  }
  if (FUTURE_RE.test(claim)) {
    return { verdict: "UNDECIDABLE", category: "subjective", basis: "future-contingent",
      proof: "Gelecek-olumsal ifade — şu an deterministik olarak doğrulanamaz." };
  }
  return null;
}

// ───────────────────────────── classify + verify (dispatcher) ─────────────────────────────
const ARITH_RE = /[0-9].*(?:[=<>]|!=|==|≠|≤|≥)/;

export function classify(claim: string): Category {
  if (evalOrdering(claim)) return "ordering";
  if (/\b(always\s*true|always\s*false|tautolog|contradict|her\s*durumda)\b/i.test(claim)) return "logic";
  if (ARITH_RE.test(claim) && /^[\s0-9+\-*/%().,=<>!≠≤≥×÷·＝]+$/.test(claim.replace(/(==|!=|<=|>=)/g, ""))) return "arithmetic";
  if (SUBJECTIVE_RE.test(claim) || FUTURE_RE.test(claim)) return "subjective";
  return "unknown";
}

export type OracleInput = string | CodeFnRequest | CodeOutputRequest | CodeRuleRequest;

/** Saf karar prosedürü (memoizasyonsuz). `verify()` bunu sarmalar. */
function verifyUncached(input: OracleInput): OracleResult {
  if (typeof input !== "string") {
    if (input.kind === "code-functional") return evalCodeFunctional(input);
    if (input.kind === "code-output") return evalCodeOutput(input);
    if (input.kind === "code-rule") return evalCodeRule(input);
  } else {
    const claim = input.trim();
    // sıralama deterministik: ordering → logic → arithmetic → subjective → unknown
    const ord = evalOrdering(claim); if (ord) return ord;
    const log = evalLogic(claim); if (log) return log;
    if (classify(claim) === "arithmetic") {
      try { return evalArithmetic(claim); }
      catch (e) {
        const m = String((e as Error).message);
        const res = m.startsWith("resource");
        return { verdict: "UNDECIDABLE", category: "arithmetic", basis: res ? "resource-bound" : "parse-error",
          proof: res ? "İfade kaynak sınırını aşıyor (çok büyük üs/sayı); deterministik olarak güvenle değerlendirilemez."
                     : `Aritmetik ayrıştırılamadı: ${m}` };
      }
    }
    const sub = evalSubjective(claim); if (sub) return sub;
  }
  return { verdict: "UNDECIDABLE", category: "unknown", basis: "out-of-scope",
    proof: "Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez." };
}

// ───────────────────────────── Memoizasyon (içerik-adresli LRU) ─────────────────────────────
// Oracle saf + deterministik → aynı girdi her zaman aynı sonuç → önbellek güvenli (kaynak: memoization).
// `file:` içeren kod istekleri DOSYA İÇERİĞİ hash'iyle anahtarlanır → bayat dosya yanlış cache vermez.
const MEMO_MAX = Number(process.env.ORACLE_MEMO_MAX || "2000");
const memo = new Map<string, OracleResult>();
export function clearMemo(): void { memo.clear(); }
export function memoSize(): number { return memo.size; }

function cacheKey(input: OracleInput): string | null {
  if (typeof input === "string") return "s:" + input.trim().replace(/\s+/g, " ");
  const base: Record<string, unknown> = { ...input };
  if (input.kind === "code-output" && input.file) {
    try { base.__fileHash = createHash("sha1").update(readFileSync(input.file)).digest("hex"); }
    catch { return null; } // dosya okunamıyor → önbellekleme (bayat-sonuç riski yok)
  }
  return "o:" + createHash("sha1").update(JSON.stringify(base)).digest("hex");
}
function cacheGet(key: string | null): OracleResult | undefined {
  if (key === null) return undefined;
  const hit = memo.get(key);
  if (hit) { memo.delete(key); memo.set(key, hit); } // LRU: en yeniye taşı
  return hit;
}
function cacheSet(key: string | null, r: OracleResult): void {
  if (key === null) return;
  memo.set(key, r);
  if (memo.size > MEMO_MAX) { const oldest = memo.keys().next().value; if (oldest !== undefined) memo.delete(oldest); }
}

/** Ana giriş (memoized): önermeyi/kodu deterministik olarak TRUE/FALSE/UNDECIDABLE'a bağlar. */
export function verify(input: OracleInput): OracleResult {
  const key = cacheKey(input);
  const hit = cacheGet(key);
  if (hit) return hit;
  const r = verifyUncached(input);
  cacheSet(key, r);
  return r;
}

// ───────────────────────────── Async + paralel batch ─────────────────────────────
// Kod-exec TAZE izole subprocess'te kalır (worker_threads YOK); async execFile birden çoğunu
// AYNI ANDA koşturarak batch verimini artırır. Saf+bağımsız girdiler → paralel güvenli.
async function verifyUncachedAsync(input: OracleInput): Promise<OracleResult> {
  if (typeof input !== "string" && input.kind === "code-output") return evalCodeOutputAsync(input);
  return verifyUncached(input); // string / code-functional / code-rule: ucuz veya nadir → senkron
}
async function verifyAsync(input: OracleInput): Promise<OracleResult> {
  const key = cacheKey(input);
  const hit = cacheGet(key);
  if (hit) return hit;
  const r = await verifyUncachedAsync(input);
  cacheSet(key, r);
  return r;
}
/** Bağımsız girdileri sınırlı eşzamanlılıkla paralel doğrula (her kod-exec kendi izole subprocess'inde). */
export async function verifyMany(inputs: OracleInput[], concurrency = Math.max(1, cpus().length - 2)): Promise<OracleResult[]> {
  const out: OracleResult[] = new Array(inputs.length);
  let i = 0;
  const worker = async () => { while (i < inputs.length) { const idx = i++; out[idx] = await verifyAsync(inputs[idx]); } };
  const n = Math.max(1, Math.min(concurrency, inputs.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
