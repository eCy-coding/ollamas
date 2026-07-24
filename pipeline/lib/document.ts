// The canonical output document (pure) — the master prompt's own contract.
//
// WHY THIS EXISTS
// `~/Desktop/eCym.md` states it plainly: "Your final reply **must be a single JSON document**"
// with eight top-level keys. v3 executed the whole DAG and measured it honestly, but never
// assembled that document: `todo_board`, `benchmark_configuration`, `ci_cd_yaml` and
// `references` did not exist anywhere in the codebase, and `search_results` / `thoughts` /
// `analysis` lived only as free-text values in a context bag. The pipeline satisfied its own
// gates while silently failing the spec it was built from.
//
// Assembly is pure and validation is separate, because the interesting failure is not "the
// build crashed" — it is "the document came out shaped correctly but MEANING nothing":
// citations pointing at reference ids that do not exist, a severity the schema never
// defined, a `thoughts` section that is an empty string. `validateDocument()` exists to make
// those loud.
import type { PipelineStep } from "./dag";
import type { Thresholds } from "./gates";

// ── the eight keys ────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 1-based citation index. `evidence: "[2]"` resolves here. */
  ref_id: number;
  /** "cckb" for the local capsule layer, or the web backend that answered. */
  source?: string;
}

/** The five phases the prompt names. Each is free-form text, ≤250 words by instruction. */
export interface Thoughts {
  research: string;
  planning: string;
  development: string;
  verification: string;
  production: string;
}

export type Severity = "high" | "medium" | "low";

export interface Gap {
  issue: string;
  severity: Severity;
  /** A citation like "[2]" — must resolve against `references` or `search_results`. */
  evidence: string;
  /** "llm" when the model returned structured output; "deterministic" when it did not. */
  source?: "llm" | "deterministic";
}

export interface Analysis {
  research_gaps: Gap[];
  planning_gaps: Gap[];
  development_gaps: Gap[];
  verification_gaps: Gap[];
  production_gaps: Gap[];
}

export interface PlanSection {
  dag: PipelineStep[];
}

export interface TodoEntry {
  id: string;
  description: string;
  owner: string;
  estimate_h: number;
  status: string;
}

export interface BenchmarkConfiguration {
  metrics: string[];
  percentiles: string[];
  runs_per_config: number;
  warmup_per_config: number;
  load_models: Record<string, Record<string, number>>;
  tools: Record<string, string>;
  quality_gates: Thresholds;
}

export interface Reference {
  ref_id: number;
  title: string;
  url: string;
  /** Live HTTP status when checked. 0 = unreachable, undefined = not checked. */
  status?: number;
  /** Which design decision rests on it — a URL list is not a reference. */
  why?: string;
}

export interface DocumentMeta {
  run_id: string;
  /** ISO-8601 UTC, per the prompt's explicit requirement. */
  timestamp: string;
  workflow_version: string;
  profile: string;
  git_sha: string;
  /** "complete" only when the run passed AND the self-audit found no gaps. */
  status: "complete" | "incomplete";
}

export interface PipelineDocument {
  schema: "ecym-pipeline/document@1";
  meta: DocumentMeta;
  search_results: SearchResult[];
  thoughts: Thoughts;
  analysis: Analysis;
  plan: PlanSection;
  todo_board: TodoEntry[];
  benchmark_configuration: BenchmarkConfiguration;
  ci_cd_yaml: string;
  references: Reference[];
}

/** The eight keys the prompt requires, checked by name so a rename cannot pass silently. */
export const REQUIRED_KEYS = [
  "search_results", "thoughts", "analysis", "plan",
  "todo_board", "benchmark_configuration", "ci_cd_yaml", "references",
] as const;

export const THOUGHT_PHASES = ["research", "planning", "development", "verification", "production"] as const;
export const GAP_SECTIONS = [
  "research_gaps", "planning_gaps", "development_gaps", "verification_gaps", "production_gaps",
] as const;
export const SEVERITIES: readonly Severity[] = ["high", "medium", "low"];

// ── assembly ──────────────────────────────────────────────────────────────────

export interface BuildDocumentInput {
  meta: DocumentMeta;
  search_results?: SearchResult[];
  thoughts?: Partial<Thoughts>;
  analysis?: Partial<Analysis>;
  dag: PipelineStep[];
  todo_board?: TodoEntry[];
  benchmark_configuration: BenchmarkConfiguration;
  ci_cd_yaml: string;
  references?: Reference[];
}

/**
 * Assemble the document, filling absent sections with EMPTY values of the right shape.
 *
 * Empty is not the same as missing: an empty `research_gaps` array is a legitimate claim
 * ("we looked and found none"), while an absent key means nobody looked. The builder always
 * produces the key so the shape is stable, and `validateDocument()` is what reports that a
 * section is empty — separating "structurally valid" from "actually populated".
 */
export function buildDocument(i: BuildDocumentInput): PipelineDocument {
  const thoughts = Object.fromEntries(
    THOUGHT_PHASES.map((p) => [p, i.thoughts?.[p] ?? ""]),
  ) as unknown as Thoughts;
  const analysis = Object.fromEntries(
    GAP_SECTIONS.map((s) => [s, i.analysis?.[s] ?? []]),
  ) as unknown as Analysis;
  return {
    schema: "ecym-pipeline/document@1",
    meta: i.meta,
    search_results: i.search_results ?? [],
    thoughts,
    analysis,
    plan: { dag: i.dag },
    todo_board: i.todo_board ?? [],
    benchmark_configuration: i.benchmark_configuration,
    ci_cd_yaml: i.ci_cd_yaml,
    references: i.references ?? [],
  };
}

// ── validation ────────────────────────────────────────────────────────────────

export interface DocIssue {
  /** `error` blocks the document from being called valid; `warn` is reported and allowed. */
  level: "error" | "warn";
  key: string;
  message: string;
}

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** Extract every `[n]` citation index from a string. */
export function citations(s: string): number[] {
  return [...String(s ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

/**
 * Report everything wrong with the document.
 *
 * Errors are structural or referential — a missing key, a citation pointing nowhere, a
 * severity outside the schema. Warnings are emptiness: sections that exist but say nothing.
 * The distinction matters because a run with no web access legitimately produces zero
 * search results, and that must be reportable without being a failure.
 */
export function validateDocument(doc: unknown): DocIssue[] {
  const out: DocIssue[] = [];
  const err = (key: string, message: string) => out.push({ level: "error", key, message });
  const warn = (key: string, message: string) => out.push({ level: "warn", key, message });

  if (!doc || typeof doc !== "object") {
    return [{ level: "error", key: "document", message: "not an object" }];
  }
  const d = doc as Partial<PipelineDocument> & Record<string, unknown>;

  for (const k of REQUIRED_KEYS) {
    if (!(k in d)) err(k, "required key missing");
  }

  // meta / reproducibility
  if (!d.meta) err("meta", "missing");
  else {
    if (!d.meta.run_id) err("meta.run_id", "missing");
    if (!ISO8601.test(String(d.meta.timestamp))) {
      err("meta.timestamp", `not ISO-8601 UTC: ${d.meta.timestamp}`);
    }
    if (!["complete", "incomplete"].includes(String(d.meta.status))) {
      err("meta.status", `unknown status '${d.meta.status}'`);
    }
  }

  // references: ids unique and 1..n, so a citation index is unambiguous
  const refIds = new Set<number>();
  if (Array.isArray(d.references)) {
    d.references.forEach((r, idx) => {
      if (!Number.isInteger(r?.ref_id) || r.ref_id < 1) err(`references[${idx}].ref_id`, "must be an integer ≥ 1");
      else if (refIds.has(r.ref_id)) err(`references[${idx}].ref_id`, `duplicate ref_id ${r.ref_id}`);
      else refIds.add(r.ref_id);
      if (!r?.url) err(`references[${idx}].url`, "missing");
    });
    if (!d.references.length) warn("references", "empty");
  }

  const searchIds = new Set<number>();
  if (Array.isArray(d.search_results)) {
    d.search_results.forEach((s, idx) => {
      if (!Number.isInteger(s?.ref_id) || s.ref_id < 1) err(`search_results[${idx}].ref_id`, "must be an integer ≥ 1");
      else searchIds.add(s.ref_id);
      if (!s?.url) err(`search_results[${idx}].url`, "missing");
    });
    if (!d.search_results.length) warn("search_results", "empty — no search was performed or it degraded");
  }
  const citable = new Set([...refIds, ...searchIds]);

  // thoughts: all five phases present; empty is a warning, absent is an error
  for (const p of THOUGHT_PHASES) {
    const v = d.thoughts?.[p];
    if (v === undefined) err(`thoughts.${p}`, "missing phase");
    else if (!String(v).trim()) warn(`thoughts.${p}`, "empty");
  }

  // analysis: five gap sections, each entry structurally checked and its citation resolved
  for (const sec of GAP_SECTIONS) {
    const gaps = d.analysis?.[sec];
    if (gaps === undefined) {
      err(`analysis.${sec}`, "missing section");
      continue;
    }
    if (!Array.isArray(gaps)) {
      err(`analysis.${sec}`, "not an array");
      continue;
    }
    if (!gaps.length) warn(`analysis.${sec}`, "empty");
    gaps.forEach((g, idx) => {
      const at = `analysis.${sec}[${idx}]`;
      if (!g?.issue?.trim()) err(`${at}.issue`, "empty");
      if (!SEVERITIES.includes(g?.severity)) {
        err(`${at}.severity`, `invalid severity '${g?.severity}' (expected ${SEVERITIES.join("|")})`);
      }
      const cites = citations(g?.evidence ?? "");
      if (!cites.length) {
        // A gap with no citation is an opinion. The prompt asks for evidence-based analysis,
        // so an unsourced finding is reported rather than quietly accepted.
        err(`${at}.evidence`, "no citation — evidence must reference a source like '[2]'");
      }
      for (const c of cites) {
        if (!citable.has(c)) err(`${at}.evidence`, `citation [${c}] does not resolve to any reference or search result`);
      }
    });
  }

  // plan
  if (!Array.isArray(d.plan?.dag)) err("plan.dag", "missing or not an array");
  else if (!d.plan.dag.length) err("plan.dag", "empty — the workflow must be embedded");

  // todo_board
  if (Array.isArray(d.todo_board)) {
    d.todo_board.forEach((t, idx) => {
      if (!t?.id) err(`todo_board[${idx}].id`, "missing");
      if (typeof t?.estimate_h !== "number") err(`todo_board[${idx}].estimate_h`, "must be a number");
    });
  }

  // benchmark_configuration: the prompt requires numeric thresholds, not strings
  const bc = d.benchmark_configuration;
  if (bc) {
    if (!Array.isArray(bc.metrics) || !bc.metrics.length) err("benchmark_configuration.metrics", "empty");
    if (!Array.isArray(bc.percentiles) || !bc.percentiles.length) err("benchmark_configuration.percentiles", "empty");
    if (typeof bc.runs_per_config !== "number") err("benchmark_configuration.runs_per_config", "must be a number");
    const q = bc.quality_gates as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(q ?? {})) {
      if (Array.isArray(v)) continue;
      if (typeof v !== "number") err(`benchmark_configuration.quality_gates.${k}`, `must be numeric, got ${typeof v}`);
    }
  }

  if (typeof d.ci_cd_yaml !== "string" || !d.ci_cd_yaml.trim()) {
    err("ci_cd_yaml", "missing or empty");
  }

  return out;
}

export const isValid = (issues: DocIssue[]): boolean => !issues.some((i) => i.level === "error");

/** Operator-facing summary: counts first, then the errors that actually block. */
export function renderIssues(issues: DocIssue[]): string[] {
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  return [
    `document: ${errors.length} error(s), ${warns.length} warning(s)`,
    ...errors.map((i) => `  ERROR ${i.key}: ${i.message}`),
    ...warns.map((i) => `  warn  ${i.key}: ${i.message}`),
  ];
}
