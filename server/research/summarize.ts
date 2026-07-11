// O2 Faz 1 (docs/odyssey/05-features/research.md §FAZ 1) — the summarize layer.
// Thin on purpose: LLM calls go through the injected `deps.generate` (production
// wires ai.ts generateText — no new provider, RESEARCH_MODEL falls back to
// MAC_MODEL_CHAMPION). URL attribution is preserved through the summary object so
// the report stage (Faz 4) can cite sources honestly. LLM failure is fail-soft:
// research keeps going on the raw snippet rather than aborting the whole run.
export const RESEARCH_MAX_SOURCE_CHARS = Number(process.env.RESEARCH_MAX_SOURCE_CHARS) || 6000;

/** Pure fixed-size chunking (no word-boundary awareness needed — just a size cap
 *  for prompt-building). Empty text → no chunks. */
export function chunkForSummary(text: string, maxChars: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

export interface SourceInput {
  title: string;
  url: string;
  text: string;
}

export interface SourceSummary {
  url: string;
  title: string;
  summary: string;
  keyPoints: string[];
}

export interface SummarizeDeps {
  /** Injected LLM call (production: ai.ts generateText via RESEARCH_MODEL). */
  generate: (prompt: string) => Promise<string>;
}

/** Parse an LLM summary reply into {summary, keyPoints[]}. `- bullet` lines
 *  become keyPoints; everything else is the prose summary. */
function parseSummaryReply(reply: string): { summary: string; keyPoints: string[] } {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  const keyPoints = lines.filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ""));
  const prose = lines.filter((l) => !/^[-*]\s+/.test(l)).join(" ");
  return { summary: prose || reply.trim(), keyPoints };
}

/** Summarize one fetched source. Fails soft to the raw snippet (never throws,
 *  never cuts the research run short on a single LLM hiccup). */
export async function summarizeSource(source: SourceInput, deps: SummarizeDeps): Promise<SourceSummary> {
  const chunks = chunkForSummary(source.text.slice(0, RESEARCH_MAX_SOURCE_CHARS), RESEARCH_MAX_SOURCE_CHARS);
  const body = chunks[0] ?? "";
  try {
    const prompt =
      `Summarize the following source for a research report. Title: "${source.title}". ` +
      `Respond with a short prose summary followed by "- " bulleted key points.\n\n${body}`;
    const reply = await deps.generate(prompt);
    const { summary, keyPoints } = parseSummaryReply(reply);
    return { url: source.url, title: source.title, summary, keyPoints };
  } catch {
    // Fail-soft: the raw snippet still carries information, and the run continues.
    return { url: source.url, title: source.title, summary: source.text.slice(0, 500), keyPoints: [] };
  }
}
