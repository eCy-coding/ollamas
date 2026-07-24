// Gap extraction (pure) — turn an analysis answer into citable findings.
//
// WHY THIS EXISTS
// The prompt asks `analyze` to output objects: `{issue, severity: high|medium|low, evidence}`.
// v3's `analyze` returned free prose, so `analysis_*` never existed as data and nothing could
// be validated, sorted by severity, or checked for a source.
//
// The hard part is not parsing JSON when the model cooperates — it is what to do when it does
// not. The tempting move is to guess a severity from wording ("critical" → high). That
// manufactures a number nobody measured, and severity drives the merge gate. So an
// unparseable answer degrades to `source: "deterministic"` findings that carry the model's
// own sentences, an explicitly conservative severity, and the citation the text actually
// contained — never one invented to satisfy the schema.
import type { Gap, Severity } from "./document";
import { SEVERITIES, citations } from "./document";

export interface ExtractResult {
  gaps: Gap[];
  /** "llm" when structured output was parsed; "deterministic" when it had to be derived. */
  source: "llm" | "deterministic";
  /** Why the deterministic path was taken — surfaced, never hidden. */
  reason?: string;
}

/** Normalise a model's severity token. Anything unrecognised is rejected, not coerced. */
export function normalizeSeverity(v: unknown): Severity | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (SEVERITIES.includes(s as Severity)) return s as Severity;
  // Common synonyms the models actually emit. Deliberately a SHORT list: every entry here is
  // a mapping someone can audit, not a fuzzy match that quietly upgrades a finding.
  if (s === "critical" || s === "severe" || s === "blocker") return "high";
  if (s === "moderate" || s === "med" || s === "warning") return "medium";
  if (s === "minor" || s === "info" || s === "trivial" || s === "nit") return "low";
  return null;
}

/** First fenced or bare JSON array/object in the text, or null. */
function firstJson(text: string): unknown {
  const t = String(text ?? "");
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], t.match(/\[[\s\S]*\]/)?.[0], t.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/**
 * Split prose into candidate findings.
 *
 * Bullets first (models overwhelmingly answer in lists); otherwise sentences. Fragments
 * shorter than 20 characters are dropped — "N/A", "None." and stray list markers are not
 * findings, and admitting them would inflate the gap count with noise.
 */
function proseFindings(text: string): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];
  const bullets = t
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length >= 20);
  if (bullets.length >= 2) return bullets;
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 20);
}

export interface ExtractOptions {
  /** Citation used when a finding carries none. Should be a ref the caller KNOWS resolves. */
  defaultEvidence?: string;
  max?: number;
}

/**
 * Extract gaps from a model answer.
 *
 * Structured input wins. When it is absent or unusable, the deterministic path keeps the
 * model's own words as the issue text and assigns `medium` — not because the finding is
 * medium, but because an unverified severity must not be allowed to read as `high` and block
 * a merge, nor as `low` and be ignored. `source: "deterministic"` makes that visible so a
 * reader knows the severity was not asserted by anyone.
 */
export function extractGaps(answer: unknown, o: ExtractOptions = {}): ExtractResult {
  const max = o.max ?? 8;
  const fallbackCite = o.defaultEvidence ?? "";
  const text = typeof answer === "string" ? answer : JSON.stringify(answer ?? "");

  const parsed = typeof answer === "object" && answer !== null ? answer : firstJson(text);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { gaps?: unknown[] })?.gaps)
      ? (parsed as { gaps: unknown[] }).gaps
      : null;

  if (rows) {
    const gaps: Gap[] = [];
    let rejected = 0;
    for (const r of rows.slice(0, max)) {
      const row = r as Record<string, unknown>;
      const issue = String(row.issue ?? row.gap ?? row.description ?? "").trim();
      const severity = normalizeSeverity(row.severity);
      const evidence = String(row.evidence ?? row.ref ?? "").trim() || fallbackCite;
      if (!issue || !severity || !citations(evidence).length) {
        rejected++;
        continue;
      }
      gaps.push({ issue, severity, evidence, source: "llm" });
    }
    if (gaps.length) {
      return {
        gaps,
        source: "llm",
        ...(rejected ? { reason: `${rejected} row(s) rejected: missing issue/severity/citation` } : {}),
      };
    }
    return deterministic(text, fallbackCite, max, "structured output present but no row passed validation");
  }

  return deterministic(text, fallbackCite, max, "model returned prose, not structured gaps");
}

function deterministic(text: string, fallbackCite: string, max: number, reason: string): ExtractResult {
  const found = proseFindings(text).slice(0, max);
  const gaps: Gap[] = found
    .map((issue) => {
      const cite = citations(issue).length ? issue.match(/\[\d+\]/)![0] : fallbackCite;
      return cite ? { issue, severity: "medium" as Severity, evidence: cite, source: "deterministic" as const } : null;
    })
    .filter(Boolean) as Gap[];
  return { gaps, source: "deterministic", reason: gaps.length ? reason : `${reason}; no citable finding` };
}

/** high → medium → low, so the reader meets the blocking findings first. */
export function bySeverity(gaps: Gap[]): Gap[] {
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return [...gaps].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Counts per severity — feeds the document summary and the operator's first glance. */
export function severityCounts(gaps: Gap[]): Record<Severity, number> {
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const g of gaps) if (out[g.severity] !== undefined) out[g.severity]++;
  return out;
}
