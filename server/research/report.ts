// O2 Faz 4 (docs/odyssey/05-features/research.md §FAZ 4) — atıflı (cited) report
// synthesis. Anti-hallucination contract (P5 CRITICAL): the LLM only ever sees
// the gathered summaries (never asked to invent), every claim must carry a [n]
// citation, and an empty source list produces an honest "no sources found"
// report rather than a fabricated one. A synthesis with ANY uncited sentence is
// treated as a contract violation and replaced with an honest-empty report
// rather than shipped half-attributed.
import type { SourceSummary } from "./summarize";

export interface Citation {
  n: number;
  title: string;
  url: string;
  domain: string;
}

export interface ReportResult {
  report: string;
  citations: Citation[];
}

export interface ReportDeps {
  generate: (prompt: string) => Promise<string>;
  /** deep=true routes to RESEARCH_DEEP_MODEL when configured (P3.4). */
  deep?: boolean;
  pickModel?: (deep: boolean) => string;
  /** Cross-run RAG context (Faz 3 P6) — prior research findings pulled from
   *  server/rag.ts before synthesis. Purely additive context; citations are still
   *  built ONLY from `gathered` (the current run's sources) so numbering stays honest. */
  ragContext?: { id: string; text: string; distance: number }[];
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Every non-blank sentence must contain a [n] marker — a stricter contract than
 *  "at least one citation exists somewhere", closing the loophole where only the
 *  first sentence is attributed and the rest is fabricated. */
function everyClaimCited(text: string): boolean {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return false;
  return sentences.every((s) => /\[\d+\]/.test(s));
}

const NO_SOURCES_REPORT = "No sources found — the research run gathered nothing to report on.";
const UNATTRIBUTED_REPORT =
  "Could not attribute the synthesis to a source — no report was generated rather than ship an uncited claim.";

/** Build the final cited report. `gathered` is the ONLY context the LLM sees for
 *  synthesis (anti-hallucination) — citations are built mechanically from it, not
 *  parsed out of the LLM reply, so the numbered list is always consistent. */
export async function buildReport(question: string, gathered: SourceSummary[], deps: ReportDeps): Promise<ReportResult> {
  if (!gathered.length) {
    return { report: NO_SOURCES_REPORT, citations: [] };
  }

  const citations: Citation[] = gathered.map((g, i) => ({
    n: i + 1,
    title: g.title,
    url: g.url,
    domain: domainOf(g.url),
  }));

  const model = deps.pickModel?.(deps.deep ?? false);
  const digest = gathered.map((g, i) => `[${i + 1}] ${g.title} (${g.url}): ${g.summary}`).join("\n");
  const priorFindings = deps.ragContext?.length
    ? `\n\nPrior research findings (context only, NOT independently citable):\n${deps.ragContext.map((h) => `- ${h.text}`).join("\n")}\n`
    : "";
  const prompt =
    `Question: ${question}\n\nSources (use ONLY these, cite every claim with its [n]):\n${digest}\n` +
    priorFindings +
    `\nWrite a cited synthesis. Every sentence MUST end with a [n] citation matching a source above. ` +
    (model ? `Model: ${model}.` : "");

  const reply = await deps.generate(prompt);

  if (!everyClaimCited(reply)) {
    return { report: UNATTRIBUTED_REPORT, citations: [] };
  }

  return { report: reply, citations };
}
