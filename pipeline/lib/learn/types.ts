// learn/types — the shape of a LESSON before it is rendered, and of the RECIPE that makes it
// executable by ollamas and eCym.
//
// WHY A "CONSTRUCT" AND NOT A "PAGE"
// The operator's completeness bar is "%100 eksiksiz". Over MDN (~10k pages) that claim is
// unfalsifiable, so it is redefined against a finite set we control: the language constructs
// that OUR OWN CODE actually uses. A `Construct` is therefore two things at once —
//   1. an authored lesson (our prose, our exercise, our reasoning), and
//   2. a DETECTOR (`pattern` + `files`) that proves the construct really occurs in this
//      codebase and pulls a real `path:line` example.
// A construct whose detector finds zero occurrences is dropped from the inventory: we do not
// teach what we do not use, and we never ship a stub. Coverage is then `lessons / detected`,
// which is checkable rather than rhetorical.
//
// WHY EVERY LESSON CARRIES A RECIPE
// A snippet inside a note is inert. ollamas refuses unknown binaries with exit 126 (lesson
// L37: `df -h` was "recorded as run" for weeks while actually being blocked), and eCym only
// acts on catalog entries. So each lesson ships a tiny, self-contained program with an EXPECTED
// stdout. `learnkb apply <id>` runs it and diffs the output. That turns "ollamas/eCym can apply
// the code" from a claim into a gate check.

/** Difficulty, used for beginner→advanced ordering (The Odin Project's path model). */
export type Level = "temel" | "orta" | "ileri";

/** Interpreter a recipe runs under. Deliberately tiny: no package installs, no network. */
export type RecipeLang = "node" | "python" | "bash";

export interface Recipe {
  /** Same id as the lesson slug — one recipe per lesson, addressable by `learnkb apply <id>`. */
  id: string;
  lang: RecipeLang;
  /** Self-contained program. No imports beyond the stdlib, no filesystem writes, no network. */
  code: string;
  /** Exact substring the program must print. The gate diffs on this. */
  expect: string;
  /**
   * `safe` = read-only, deterministic, runnable unattended (the default).
   * `gated` = touches real files or needs approval; `learnkb apply` refuses without `--gated`.
   */
  safety: "safe" | "gated";
}

/**
 * A machine-actionable RULE derived from a lesson — the difference between a system that can
 * *look the answer up* and a system that *behaves differently*.
 *
 * WHY THIS EXISTS
 * Waves 1–2 gave the four systems retrieval (`learnkb ask/get`) and a demo (`learnkb apply`).
 * Neither changes what they DO. A policy closes that: it names the anti-pattern in a form a
 * program can detect, states the fix, and carries the reason so the rule can be argued with
 * rather than obeyed blindly.
 *
 * THREE VERDICTS, NOT TWO
 * The probe that motivated this found 79 `|| <number>` sites, 37 `exec(` sites, 36 `open()`
 * calls without `encoding=`. Many are correct in context. A rule that calls all of them
 * violations is noise, and a noisy linter loses trust as fast as a blind one — so every policy
 * carries `exceptions`, each with a written reason. Hits are then `violation`,
 * `justified` or clean. This mirrors the curriculum map's three verdicts and the repo's own
 * eslint style (`rules: off` plus a comment saying why).
 */
export interface PolicyException {
  /** Paths where the anti-pattern is CORRECT. Matched against the same label as occurrences. */
  path: RegExp;
  /** Why it is correct there. Empty is rejected by the validator — an unexplained exemption is a hole. */
  reason: string;
}

export interface Policy {
  /** Same id as the lesson: one rule per lesson, addressable by `learnkb lint --rule <id>`. */
  id: string;
  /** `hata` = must not increase (gate); `uyarı` = reported, not gated. */
  severity: "hata" | "uyarı";
  /** The ANTI-PATTERN — what the violation looks like. Must differ from the lesson's `pattern`,
   *  which matches CORRECT usage; conflating the two flags every good line as a defect. */
  detect: RegExp;
  /** Which files the rule applies to. */
  files: RegExp;
  /** What to write instead — concrete enough for a code generator to follow. */
  fix: string;
  /** Why the rule exists, in one sentence. Systems quote this when they refuse something. */
  why: string;
  /**
   * Match against the ORIGINAL text instead of the comment-stripped one.
   *
   * The linter blanks comments before matching, because a rule that flags the sentence
   * EXPLAINING it is noise. But some rules mean the opposite: `catch { /* neden * / }` is the
   * COMPLIANT form of an empty catch, and blanking the comment turned 96 compliant sites into
   * violations on the first run. Those rules read the raw source.
   */
  raw?: boolean;
  /** Places where the anti-pattern is legitimate. */
  exceptions?: PolicyException[];
}

export interface Construct {
  /** Lesson slug, kebab-case, globally unique across tracks. Also the recipe id. */
  id: string;
  /** Track id from `CURRICULUM` in learnrefs.ts. */
  track: string;
  /** Lesson title, Turkish. */
  title: string;
  level: Level;
  /** Canonical source id from `LEARN_SOURCES`. */
  source: string;
  /** Deep link into that source. Falls back to the source's root URL when absent. */
  url?: string;
  /** Detector: what this construct looks like in real code. */
  pattern: RegExp;
  /** Which files the detector may look at (matched against the repo-relative path). */
  files: RegExp;
  /** The explanation — OUR words. Never copied from any source (see learnrefs textPolicy). */
  what: string;
  /** Why this codebase uses it here — the part no external tutorial can tell you. */
  whyHere: string;
  /** A checkable exercise. */
  exercise: string;
  recipe: Recipe;
  /**
   * Machine-actionable rule, when the lesson HAS a violation form.
   *
   * Optional on purpose: `js-array-map` cannot be violated — inventing an anti-pattern for it
   * would be the stub problem in a new costume. Coverage is therefore reported as
   * `policies / policy-able`, and the lessons without one say so instead of pretending.
   */
  policy?: Policy;
  /** Optional extra wikilink targets (other lesson ids) for the graph. */
  related?: string[];
}

/** One proven occurrence of a construct in our code. */
export interface Occurrence {
  /** Repo- or vault-relative path, prefixed by the system id, e.g. `ollamas:pipeline/lib/dag.ts`. */
  path: string;
  line: number;
  /** The matching source line, trimmed and length-bounded. */
  snippet: string;
}

/** A construct plus the evidence that it is really used here. */
export interface InventoryEntry {
  construct: Construct;
  hits: number;
  /** Up to `MAX_EXAMPLES` real occurrences, best-first (shortest, most readable line wins). */
  examples: Occurrence[];
  /** Which systems (ollamas/ecym/obsidian/claudecode) this construct was found in. */
  systems: string[];
}

export const MAX_EXAMPLES = 3;

/** Guard: a construct with no detected occurrence must never become a lesson. */
export function isTaught(e: InventoryEntry): boolean {
  return e.hits > 0 && e.examples.length > 0;
}
