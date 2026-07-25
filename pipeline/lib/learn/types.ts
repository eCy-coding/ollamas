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
