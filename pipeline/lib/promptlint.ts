// promptlint — enforce a slice of the project's founding rule as an automated gate: "a prompt that
// names a FILE PATH it cannot reach is fiction." Scope is deliberately narrow and honest (MISS ≠
// PASS): it checks path-shaped tokens (`a/b.ts`, `~/x`) against the real filesystem. It does NOT
// verify bare tool/model names (`gpt-4o`, `Redis`, `k6`) — those need `command -v`/config lookups and
// would false-positive on correction prose (eCym.md legitimately QUOTES `gpt-4o` in its correction
// table). Bare-token verification is intentionally out of scope; do not claim otherwise.
//
// PURE: `extractRefs` finds the concrete local file/dir paths a prompt names; `lintPrompt` takes an
// injected `isReal` predicate and flags every path that does not resolve. The filesystem check lives
// in the bin, so the logic stays unit-testable without touching disk. URLs are warned (not verifiable
// offline), never errored; prose words are ignored — only real path-shaped tokens are checked.

export interface PromptRef {
  kind: "path" | "home" | "url";
  value: string;
}

export interface LintIssue {
  level: "error" | "warn";
  ref: string;
  message: string;
}

const FILE_EXT = "ts|tsx|js|mjs|cjs|py|sh|zsh|json|md|yaml|yml|canvas|base";
// A repo-relative path: a slash-joined token ending in a known extension, e.g. pipeline/lib/htmlsite.ts.
const PATH_RE = new RegExp(String.raw`\b([\w.-]+\/[\w./-]*\.(?:${FILE_EXT}))\b`, "g");
// A home path: ~/… up to whitespace/backtick/paren/quote.
const HOME_RE = /(~\/[^\s`)'"]+)/g;
const URL_RE = /\bhttps?:\/\/[^\s`)'"]+/g;

/** Extract the concrete path/url references a prompt names (deduped, in first-seen order). */
export function extractRefs(text: string): PromptRef[] {
  const seen = new Set<string>();
  const out: PromptRef[] = [];
  const add = (kind: PromptRef["kind"], value: string) => {
    // strip a trailing punctuation the regex may have caught
    const v = value.replace(/[.,;:]+$/, "");
    const key = `${kind}:${v}`;
    if (!seen.has(key)) { seen.add(key); out.push({ kind, value: v }); }
  };
  for (const m of String(text ?? "").matchAll(HOME_RE)) add("home", m[1]);
  for (const m of String(text ?? "").matchAll(URL_RE)) add("url", m[0]);
  for (const m of String(text ?? "").matchAll(PATH_RE)) {
    if (!m[1].startsWith("~")) add("path", m[1]);
  }
  return out;
}

/**
 * Lint a prompt: every path/home ref that `isReal` rejects is an ERROR (fiction). URL refs are a
 * WARN (offline-unverifiable). Deterministic — no clock/random, no disk (isReal is injected).
 */
export function lintPrompt(text: string, isReal: (ref: PromptRef) => boolean): LintIssue[] {
  const out: LintIssue[] = [];
  for (const ref of extractRefs(text)) {
    // A templated ref (`<system>`, `{{name}}`) is a PATTERN, not a claim of a literal file — skip it.
    if (/[<>{}]/.test(ref.value)) continue;
    if (ref.kind === "url") {
      out.push({ level: "warn", ref: ref.value, message: "URL not verified offline" });
    } else if (!isReal(ref)) {
      out.push({ level: "error", ref: ref.value, message: `names a ${ref.kind} that does not exist — fiction` });
    }
  }
  return out;
}

/** True if the prompt has zero fiction (no error-level issues). */
export function isGrounded(issues: LintIssue[]): boolean {
  return !issues.some((i) => i.level === "error");
}

/** Human summary for the gate/tab. */
export function renderLint(name: string, issues: LintIssue[]): string[] {
  const errs = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  return [
    `${name}: ${errs.length} fiction · ${warns.length} unverified-url`,
    ...errs.map((i) => `  HATA  ${i.ref}: ${i.message}`),
  ];
}
