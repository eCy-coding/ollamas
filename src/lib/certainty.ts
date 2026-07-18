/**
 * src/lib/certainty.ts — deterministic-answer helpers (v11).
 *
 * Emre's rule: "2+2=?" must return a DEFINITIVE 4 from the source, never a hedge.
 * For questions that are computable locally (pure arithmetic), we compute the exact
 * result with a safe recursive-descent parser (no eval) BEFORE asking the model, so
 * the answer is sourced from arithmetic itself — not a probabilistic 8B guess.
 * Also strips the model's <think> reasoning so the reply reads as a definite answer.
 */

// ── Reasoning-trace stripping ──────────────────────────────────────────────
export interface Split { visible: string; reasoning: string }

/**
 * Separate a model reply into its visible answer and its <think> reasoning.
 * Handles closed blocks and an unclosed <think> (mid-stream: everything after is
 * reasoning). Safe on partial text.
 */
export function stripThink(text: string): Split {
  let reasoning = "";
  // Pull out every closed <think>…</think> block.
  let visible = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
    reasoning += (reasoning ? "\n" : "") + String(inner).trim();
    return "";
  });
  // An unclosed <think> (streaming or truncated) → hide from it onward.
  const open = visible.search(/<think>/i);
  if (open !== -1) {
    reasoning += (reasoning ? "\n" : "") + visible.slice(open).replace(/<think>/i, "").trim();
    visible = visible.slice(0, open);
  }
  return { visible: visible.trim(), reasoning: reasoning.trim() };
}

// ── Safe arithmetic evaluation (no eval) ───────────────────────────────────
export interface ArithResult { expr: string; value: number }

// Words/punctuation people wrap a bare calculation in — stripped before the
// "is this purely arithmetic?" test so we only fire on genuine math queries.
// Unicode-aware boundaries — JS \b treats Turkish ç/ş/ı/ğ/ö as non-word and would
// fail to match "kaç"/"eder"; \p{L}\p{N} lookarounds fix that.
const WRAPPER = /(?<![\p{L}\p{N}])(nedir|ne|kac|kaç|kaçtir|kaçtır|eder|hesapla|sonuc|sonuç|equals?|equal|what|is|compute|result|cevap|answer)(?![\p{L}\p{N}])/giu;

/**
 * If `text` is a pure arithmetic query, return {expr, value}; else null.
 * Supports + - * / % ^, parentheses, decimals, unary minus, and the ×/÷ glyphs.
 */
export function evalArithmetic(text: string): ArithResult | null {
  if (!text) return null;
  let s = text.toLowerCase().replace(WRAPPER, " ");
  s = s.replace(/[=?？]/g, " ").replace(/×/g, "*").replace(/÷/g, "/").trim();
  // Must be non-empty, contain a digit, and consist ONLY of math tokens.
  if (!/\d/.test(s)) return null;
  if (!/^[0-9+\-*/%^().\s]+$/.test(s)) return null;
  try {
    const value = parseExpr(tokenize(s));
    if (!Number.isFinite(value)) return null;
    return { expr: s.replace(/\s+/g, " ").trim(), value: round(value) };
  } catch {
    return null;
  }
}

function round(n: number): number {
  // Kill FP dust (0.1+0.2) without lying about genuine decimals.
  return Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : Number(n.toFixed(10));
}

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "(" } | { t: ")" };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c >= "0" && c <= "9" || c === ".") {
      let j = i;
      while (j < s.length && (s[j] >= "0" && s[j] <= "9" || s[j] === ".")) j++;
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error("bad number");
      toks.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if ("+-*/%^".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ t: "(" }); i++; continue; }
    if (c === ")") { toks.push({ t: ")" }); i++; continue; }
    throw new Error("bad char");
  }
  return toks;
}

// Recursive descent: expr = term (('+'|'-') term)* ; term = factor (('*'|'/'|'%') factor)* ;
// factor = power ; power = unary ('^' power)? ; unary = '-'? primary ; primary = num | '(' expr ')'.
function parseExpr(toks: Tok[]): number {
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];

  function expr(): number {
    let v = term();
    while (peek() && peek().t === "op" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
      const op = (eat() as { v: string }).v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = power();
    while (peek() && peek().t === "op" && "*/%".includes((peek() as { v: string }).v)) {
      const op = (eat() as { v: string }).v;
      const r = power();
      if (op === "*") v *= r;
      else if (op === "/") { if (r === 0) throw new Error("div0"); v /= r; }
      else { if (r === 0) throw new Error("mod0"); v %= r; }
    }
    return v;
  }
  function power(): number {
    const base = unary();
    if (peek() && peek().t === "op" && (peek() as { v: string }).v === "^") {
      eat();
      return Math.pow(base, power()); // right-associative
    }
    return base;
  }
  function unary(): number {
    if (peek() && peek().t === "op" && (peek() as { v: string }).v === "-") { eat(); return -unary(); }
    if (peek() && peek().t === "op" && (peek() as { v: string }).v === "+") { eat(); return unary(); }
    return primary();
  }
  function primary(): number {
    const tk = peek();
    if (!tk) throw new Error("eof");
    if (tk.t === "num") { eat(); return tk.v; }
    if (tk.t === "(") { eat(); const v = expr(); if (!peek() || peek().t !== ")") throw new Error("unbalanced"); eat(); return v; }
    throw new Error("unexpected");
  }

  const result = expr();
  if (pos !== toks.length) throw new Error("trailing"); // reject "2 2" etc.
  return result;
}

/** Format a computed answer as a definitive statement (locale-agnostic). */
export function formatCertain(r: ArithResult): string {
  return `${r.expr} = ${r.value}`;
}
