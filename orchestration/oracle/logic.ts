/**
 * orchestration/oracle/logic.ts — propositional mantık motoru.
 *
 * En iyi algoritma: keyfi formül → **Tseitin** ile eşit-doğrulanabilir CNF (lineer boyut) →
 * **DPLL** (unit-propagation + pure-literal eliminasyon + backtracking) ile SAT.
 *   F totoloji ⟺ ¬F UNSAT ;  F çelişki ⟺ F UNSAT ;  aksi → olumsal (+ tanık modeli).
 * Truth-table (brute) korrektlik oracle'ı olarak korunur → DPLL ona karşı diferansiyel test edilir.
 *
 * Kaynak: DPLL (Davis–Putnam–Logemann–Loveland), Tseytin dönüşümü.
 */

import { solveCdcl } from "./cdcl";

export type LogicClass = "tautology" | "contradiction" | "contingent";
export type LogicEngine = "cdcl" | "dpll" | "brute";
export type Assignment = Record<string, boolean>;

// ───────────────────────────── tokenize ─────────────────────────────
type BTok = { k: "var"; v: string } | { k: "op"; v: string } | { k: "par"; v: string };

export function tokenizeBool(src: string): BTok[] {
  const s = src
    .replace(/<->/g, "↔").replace(/->/g, "→")
    .replace(/\b(iff|equiv|equivalent)\b/gi, "↔")
    .replace(/\b(implies|then)\b/gi, "→")
    .replace(/\b(and)\b/gi, "∧").replace(/\b(or)\b/gi, "∨")
    .replace(/\b(not)\b/gi, "¬")
    .replace(/&&?/g, "∧").replace(/\|\|?/g, "∨").replace(/[!~]/g, "¬");
  const toks: BTok[] = [];
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    if (/[A-Za-z]/.test(ch)) toks.push({ k: "var", v: ch.toUpperCase() });
    else if (ch === "(" || ch === ")") toks.push({ k: "par", v: ch });
    else if ("¬∧∨→↔".includes(ch)) toks.push({ k: "op", v: ch });
    else throw new Error("geçersiz mantık karakteri: " + ch);
  }
  return toks;
}

// ───────────────────────────── AST + parser ─────────────────────────────
// Gramer: iff < imp < or < and < not < atom   (→ ve ↔ sağ-birleşmeli)
export type Ast =
  | { t: "var"; name: string }
  | { t: "not"; a: Ast }
  | { t: "and"; a: Ast; b: Ast }
  | { t: "or"; a: Ast; b: Ast }
  | { t: "imp"; a: Ast; b: Ast }
  | { t: "iff"; a: Ast; b: Ast };

class Parser {
  i = 0;
  constructor(private t: BTok[]) {}
  private peek() { return this.t[this.i]; }
  private eat() { return this.t[this.i++]; }
  parse(): Ast { const a = this.iff(); if (this.i !== this.t.length) throw new Error("artık belirteç"); return a; }
  private iff(): Ast { const a = this.impl(); const p = this.peek(); if (p && p.k === "op" && p.v === "↔") { this.eat(); return { t: "iff", a, b: this.iff() }; } return a; }
  private impl(): Ast { const a = this.or(); const p = this.peek(); if (p && p.k === "op" && p.v === "→") { this.eat(); return { t: "imp", a, b: this.impl() }; } return a; }
  private or(): Ast { let a = this.and(); for (let p = this.peek(); p && p.k === "op" && p.v === "∨"; p = this.peek()) { this.eat(); a = { t: "or", a, b: this.and() }; } return a; }
  private and(): Ast { let a = this.not(); for (let p = this.peek(); p && p.k === "op" && p.v === "∧"; p = this.peek()) { this.eat(); a = { t: "and", a, b: this.not() }; } return a; }
  private not(): Ast { const p = this.peek(); if (p && p.k === "op" && p.v === "¬") { this.eat(); return { t: "not", a: this.not() }; } return this.atom(); }
  private atom(): Ast {
    const p = this.eat();
    if (!p) throw new Error("beklenmedik son");
    if (p.k === "var") return { t: "var", name: p.v };
    if (p.k === "par" && p.v === "(") { const a = this.iff(); const c = this.eat(); if (!c || c.k !== "par" || c.v !== ")") throw new Error("kapanmayan parantez"); return a; }
    throw new Error("beklenmedik belirteç");
  }
}

export function parseFormula(formula: string): Ast { return new Parser(tokenizeBool(formula)).parse(); }

export function evalAst(ast: Ast, env: Assignment): boolean {
  switch (ast.t) {
    case "var": if (!(ast.name in env)) throw new Error("tanımsız değişken " + ast.name); return env[ast.name];
    case "not": return !evalAst(ast.a, env);
    case "and": return evalAst(ast.a, env) && evalAst(ast.b, env);
    case "or": return evalAst(ast.a, env) || evalAst(ast.b, env);
    case "imp": return !evalAst(ast.a, env) || evalAst(ast.b, env);
    case "iff": return evalAst(ast.a, env) === evalAst(ast.b, env);
  }
}

function collectVars(ast: Ast, acc: Set<string> = new Set()): Set<string> {
  if (ast.t === "var") acc.add(ast.name);
  else if (ast.t === "not") collectVars(ast.a, acc);
  else { collectVars(ast.a, acc); collectVars(ast.b, acc); }
  return acc;
}

// ───────────────────────────── truth-table (brute = korrektlik oracle'ı) ─────────────────────────────
export function classifyFormulaBrute(formula: string): { cls: LogicClass; modelTrue?: Assignment; modelFalse?: Assignment } {
  const ast = parseFormula(formula);
  const vars = [...collectVars(ast)].sort();
  const n = vars.length;
  if (n > 22) throw new Error("brute: çok fazla değişken (2^" + n + ")");
  let mt: Assignment | undefined, mf: Assignment | undefined;
  for (let mask = 0; mask < (1 << n); mask++) {
    const env: Assignment = {};
    vars.forEach((v, idx) => { env[v] = Boolean((mask >> idx) & 1); });
    if (evalAst(ast, env)) { if (!mt) mt = env; } else { if (!mf) mf = env; }
  }
  const cls: LogicClass = mt && !mf ? "tautology" : mf && !mt ? "contradiction" : "contingent";
  return { cls, modelTrue: mt, modelFalse: mf };
}

// ───────────────────────────── Tseitin CNF ─────────────────────────────
// Kapı başına aux değişken g ile g ↔ alt-formül; orijinal harfler 1..k, aux k+1...
function tseitin(ast: Ast): { clauses: number[][]; rootVar: number; varIds: Map<string, number>; nVars: number } {
  const varIds = new Map<string, number>();
  [...collectVars(ast)].sort().forEach((v, i) => varIds.set(v, i + 1));
  let next = varIds.size;
  const fresh = () => ++next;
  const clauses: number[][] = [];
  const enc = (node: Ast): number => {
    if (node.t === "var") return varIds.get(node.name)!;
    if (node.t === "not") { const a = enc(node.a); const g = fresh(); clauses.push([-g, -a], [g, a]); return g; }
    const a = enc(node.a), b = enc(node.b), g = fresh();
    switch (node.t) {
      case "and": clauses.push([-g, a], [-g, b], [g, -a, -b]); break;
      case "or": clauses.push([g, -a], [g, -b], [-g, a, b]); break;
      case "imp": clauses.push([g, a], [g, -b], [-g, -a, b]); break;            // g ↔ (¬a ∨ b)
      case "iff": clauses.push([-g, -a, b], [-g, a, -b], [g, a, b], [g, -a, -b]); break;
    }
    return g;
  };
  const rootVar = enc(ast);
  return { clauses, rootVar, varIds, nVars: next };
}

// ───────────────────────────── DPLL ─────────────────────────────
// assign[v]: 0 atanmamış, 1 doğru, -1 yanlış. Deterministik: en küçük indekse, önce true dalı.
// Karar bütçesi: adversaryel UNSAT örnekleri (ör. ⋁(Xᵢ∧¬Xᵢ)) kronolojik backtracking'i patlatır.
// Bütçe aşılırsa DPLL_BUDGET fırlatılır → classifyFormula ≤22 değişkende brute'a düşer (kesin, asılmaz).
const DPLL_BUDGET = 200000;
function solve(clauses: number[][], nVars: number): Int8Array | null {
  const assign = new Int8Array(nVars + 1);
  const trail: number[] = [];
  let decisions = 0;
  const litSat = (l: number) => { const a = assign[Math.abs(l)]; return a === 0 ? 0 : (a === 1) === (l > 0) ? 1 : -1; };
  const setLit = (l: number) => { assign[Math.abs(l)] = l > 0 ? 1 : -1; trail.push(Math.abs(l)); };
  const undoTo = (mark: number) => { while (trail.length > mark) assign[trail.pop()!] = 0; };

  const unitProp = (): boolean => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const cl of clauses) {
        let unit = 0, free = 0, sat = false;
        for (const l of cl) { const s = litSat(l); if (s === 1) { sat = true; break; } if (s === 0) { free++; unit = l; } }
        if (sat) continue;
        if (free === 0) return false;       // çatışma
        if (free === 1) { setLit(unit); changed = true; }
      }
    }
    return true;
  };
  const pureElim = () => {
    const pos = new Set<number>(), neg = new Set<number>();
    for (const cl of clauses) {
      if (cl.some((l) => litSat(l) === 1)) continue;
      for (const l of cl) if (assign[Math.abs(l)] === 0) { if (l > 0) pos.add(l); else neg.add(-l); }
    }
    for (const v of pos) if (!neg.has(v) && assign[v] === 0) setLit(v);
    for (const v of neg) if (!pos.has(v) && assign[v] === 0) setLit(-v);
  };

  const recurse = (): boolean => {
    const mark = trail.length;
    if (!unitProp()) { undoTo(mark); return false; }
    pureElim();
    let allSat = true;
    for (const cl of clauses) {
      if (cl.some((l) => litSat(l) === 1)) continue;
      allSat = false;
      if (!cl.some((l) => assign[Math.abs(l)] === 0)) { undoTo(mark); return false; } // çatışma
    }
    if (allSat) return true;
    let branch = 0;
    for (let v = 1; v <= nVars; v++) if (assign[v] === 0) { branch = v; break; }
    if (branch === 0) return true;
    if (++decisions > DPLL_BUDGET) throw new Error("DPLL_BUDGET");
    const m2 = trail.length;
    setLit(branch);
    if (recurse()) return true;
    undoTo(m2);
    setLit(-branch);
    if (recurse()) return true;
    undoTo(mark);
    return false;
  };

  return recurse() ? assign : null;
}

// ───────────────────────────── classifyFormula (DPLL) ─────────────────────────────
export function classifyFormula(formula: string, engine: LogicEngine = "cdcl"): { cls: LogicClass; modelTrue?: Assignment; modelFalse?: Assignment } {
  if (engine === "brute") return classifyFormulaBrute(formula);
  const ast = parseFormula(formula);
  const { clauses, rootVar, varIds, nVars } = tseitin(ast);
  const origVars = [...varIds.keys()].sort();
  const runSAT = (extra: number): Int8Array | null => {
    if (engine === "cdcl") { const r = solveCdcl([...clauses, [extra]], nVars); return r.sat ? r.model : null; }
    return solve([...clauses, [extra]], nVars);
  };

  const extract = (assign: Int8Array): Assignment => {
    const env: Assignment = {};
    for (const name of origVars) env[name] = assign[varIds.get(name)!] === 1; // atanmamış → false
    return env;
  };
  // Tanığı evalAst ile doğrula; tutmazsa (≤22 değişken) brute ile kesin tanık bul.
  const bruteWitness = (wantTrue: boolean): Assignment | undefined => {
    if (origVars.length > 22) return undefined;
    for (let mask = 0; mask < (1 << origVars.length); mask++) {
      const env: Assignment = {};
      origVars.forEach((v, i) => { env[v] = Boolean((mask >> i) & 1); });
      if (evalAst(ast, env) === wantTrue) return env;
    }
    return undefined;
  };
  const witness = (assign: Int8Array | null, wantTrue: boolean): Assignment | undefined => {
    if (!assign) return undefined;
    const env = extract(assign);
    return evalAst(ast, env) === wantTrue ? env : bruteWitness(wantTrue);
  };

  try {
    const satF = runSAT(rootVar);       // F SAT? → F'i doğru yapan model
    const satNotF = runSAT(-rootVar);   // ¬F SAT? → F'i yanlış yapan model
    const cls: LogicClass = !satNotF ? "tautology" : !satF ? "contradiction" : "contingent";
    return { cls, modelTrue: witness(satF, true), modelFalse: witness(satNotF, false) };
  } catch (e) {
    // Adversaryel örnekte bütçe aşıldıysa: ≤22 değişkende kesin truth-table'a düş (asılma yok).
    const msg = (e as Error).message;
    if ((msg === "DPLL_BUDGET" || msg === "CDCL_BUDGET") && origVars.length <= 22) return classifyFormulaBrute(formula);
    throw e;
  }
}
