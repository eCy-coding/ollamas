/**
 * orchestration/bin/lib/answer.ts — PURE core of the Definitive Answer Doctrine (GROUNDED-ANSWER.md).
 *
 * An answer has exactly two shapes: DEFINITIVE (obtained from its source: computed / executed /
 * validated / cited, evidence attached) or UNVERIFIED (honest refusal to guess, with the exact
 * failure). Nothing in between — no "maybe", no candidate lists.
 *
 * This module holds the deterministic parts: question classification, the arithmetic evaluator
 * (recursive descent — arithmetic is COMPUTED, never recalled), and the HTML structure checker.
 * Execution of code happens in the IO shell (bin/answer.ts) — real runs, real captured output.
 */

export type QuestionKind = "arithmetic" | "python" | "javascript" | "html" | "fact";

export interface Verdict {
  kind: QuestionKind;
  definitive: boolean;
  /** The answer, stated once, plainly — ONLY present when definitive. */
  answer?: string;
  /** computed | executed | validated | sourced(<origin>) — the verification path that ran. */
  method?: string;
  /** The evidence: the computation, the captured output, the checked structure, the source. */
  evidence: string;
}

export const definitive = (kind: QuestionKind, answer: string, method: string, evidence: string): Verdict =>
  ({ kind, definitive: true, answer, method, evidence });
export const unverified = (kind: QuestionKind, evidence: string): Verdict =>
  ({ kind, definitive: false, evidence });

/** Classify a raw question. Explicit flags in the CLI override this; classification never guesses —
 *  anything that is not mechanically recognizable as arithmetic/code/markup is a FACT question
 *  (which then REQUIRES a source by law #4). */
export function classifyQuestion(q: string): QuestionKind {
  const t = q.trim();
  if (/^[\d\s+\-*/^().,=?]+$/.test(t) && /\d/.test(t)) return "arithmetic";
  if (/\b(def |print\(|import |lambda |range\()/.test(t)) return "python";
  if (/\b(console\.log|=>|const |let |function )/.test(t)) return "javascript";
  if (/^\s*<!?[a-zA-Z]/.test(t) && /<\/?[a-zA-Z][^>]*>/.test(t)) return "html";
  return "fact";
}

// ── Arithmetic: deterministic recursive-descent evaluator (law #2: compute, don't recall) ────────
// Grammar: expr := term (("+"|"-") term)* ; term := factor (("*"|"/") factor)* ;
//          factor := unary ("^" factor)? ; unary := ("-")* atom ; atom := number | "(" expr ")"

interface P { s: string; i: number; }

function skipWs(p: P): void { while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++; }

function parseAtom(p: P): number {
  skipWs(p);
  if (p.s[p.i] === "(") {
    p.i++;
    const v = parseExpr(p);
    skipWs(p);
    if (p.s[p.i] !== ")") throw new Error(`expected ')' at position ${p.i}`);
    p.i++;
    return v;
  }
  const m = /^\d+(\.\d+)?/.exec(p.s.slice(p.i));
  if (!m) throw new Error(`expected a number at position ${p.i} (got "${p.s.slice(p.i, p.i + 8)}")`);
  p.i += m[0].length;
  return Number(m[0]);
}

function parseUnary(p: P): number {
  skipWs(p);
  let neg = false;
  while (p.s[p.i] === "-") { neg = !neg; p.i++; skipWs(p); }
  const v = parseAtom(p);
  return neg ? -v : v;
}

function parseFactor(p: P): number {
  const base = parseUnary(p);
  skipWs(p);
  if (p.s[p.i] === "^") { p.i++; return Math.pow(base, parseFactor(p)); } // right-assoc
  return base;
}

function parseTerm(p: P): number {
  let v = parseFactor(p);
  for (;;) {
    skipWs(p);
    const op = p.s[p.i];
    if (op !== "*" && op !== "/") return v;
    p.i++;
    const rhs = parseFactor(p);
    if (op === "/") {
      if (rhs === 0) throw new Error("division by zero");
      v = v / rhs;
    } else v = v * rhs;
  }
}

function parseExpr(p: P): number {
  let v = parseTerm(p);
  for (;;) {
    skipWs(p);
    const op = p.s[p.i];
    if (op !== "+" && op !== "-") return v;
    p.i++;
    const rhs = parseTerm(p);
    v = op === "+" ? v + rhs : v - rhs;
  }
}

/** Strip question dressing ("= ?", "?", trailing "=") so "2+2=?" evaluates "2+2". */
export function normalizeArithmetic(q: string): string {
  return q.trim().replace(/[=?\s]+$/g, "").trim();
}

/** Evaluate an arithmetic expression deterministically. Verdict is DEFINITIVE with the computation
 *  as evidence, or UNVERIFIED with the exact parser/math failure — never a guess. */
export function evalArithmetic(q: string): Verdict {
  const expr = normalizeArithmetic(q);
  if (!expr) return unverified("arithmetic", "empty expression after normalization");
  try {
    const p: P = { s: expr, i: 0 };
    const v = parseExpr(p);
    skipWs(p);
    if (p.i !== expr.length) throw new Error(`unexpected trailing input at position ${p.i} ("${expr.slice(p.i, p.i + 8)}")`);
    if (!Number.isFinite(v)) throw new Error("result is not a finite number");
    const answer = Number.isInteger(v) ? String(v) : String(Math.round(v * 1e12) / 1e12);
    return definitive("arithmetic", answer, "computed", `deterministic evaluator: ${expr} = ${answer}`);
  } catch (e) {
    return unverified("arithmetic", `cannot verify — ${(e as Error).message}`);
  }
}

// ── HTML5: mechanical structure check (honest scope: tag balance + nesting, not full spec) ───────
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export function checkHtml(src: string): Verdict {
  const stack: string[] = [];
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)\s*>/g;
  let m: RegExpExecArray | null;
  let tags = 0;
  while ((m = tagRe.exec(src)) !== null) {
    tags++;
    const [, closing, rawName, selfClose] = m;
    const name = rawName.toLowerCase();
    if (name === "!doctype") continue;
    if (closing) {
      const top = stack.pop();
      if (top !== name) {
        return unverified("html", `cannot verify as well-formed — </${name}> at index ${m.index} ${top ? `closes <${top}>` : "has no matching open tag"}`);
      }
    } else if (!selfClose && !VOID_TAGS.has(name)) {
      stack.push(name);
    }
  }
  if (tags === 0) return unverified("html", "no tags found — not recognizable as HTML");
  if (stack.length > 0) return unverified("html", `cannot verify as well-formed — unclosed: <${stack.join(">, <")}>`);
  return definitive("html", "well-formed", "validated", `structure check: ${tags} tags, all balanced (scope: tag balance + nesting, void tags honored)`);
}

/** Render a verdict for the terminal — DEFINITIVE states the answer once, plainly; UNVERIFIED
 *  refuses to guess and shows exactly what failed (law #5 and #7). */
export function renderVerdict(v: Verdict): string {
  return v.definitive
    ? `✅ ${v.answer} — DEFINITIVE (${v.method})\n   evidence: ${v.evidence}`
    : `⛔ UNVERIFIED (${v.kind}) — refusing to guess\n   ${v.evidence}`;
}
