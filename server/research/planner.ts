// O2 Faz 2 (docs/odyssey/05-features/research.md §FAZ 2) — query-decompose planner.
// Both functions are deps-injected (deps.generate — production wires ai.ts
// generateText via RESEARCH_MODEL, no new provider) so the engine loop stays
// deterministic and network-free in tests.
export const RESEARCH_MAX_QUERIES = Number(process.env.RESEARCH_MAX_QUERIES) || 4;

export interface PlannerDeps {
  generate: (prompt: string) => Promise<string>;
  maxQueries?: number;
}

/** Parse a numbered/bulleted LLM reply into a flat list of query strings. */
function parseQueryList(reply: string): string[] {
  return reply
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

/** Decompose the question into 1..maxQueries sub-queries. Falls back to
 *  [question] itself when the LLM reply is empty/unparsable (min 1 query — the
 *  research run must always have at least the original question to search). */
export async function planInitialQueries(question: string, deps: PlannerDeps): Promise<string[]> {
  const max = deps.maxQueries ?? RESEARCH_MAX_QUERIES;
  const reply = await deps.generate(
    `Decompose this research question into 2-4 focused sub-queries, one per line, numbered.\n\nQuestion: ${question}`,
  );
  const parsed = parseQueryList(reply);
  if (!parsed.length) return [question];
  return parsed.slice(0, max);
}

/** Gap-analysis: given what's been gathered so far, propose 0..N follow-up
 *  queries. An empty array is the DELIBERATE stop signal (durma kriteri, P4). */
export async function nextQueries(
  question: string,
  gathered: { url: string; title: string; summary: string; keyPoints: string[] }[],
  deps: PlannerDeps,
): Promise<string[]> {
  const max = deps.maxQueries ?? RESEARCH_MAX_QUERIES;
  const digest = gathered.map((g) => `- ${g.title}: ${g.summary}`).join("\n") || "(nothing gathered yet)";
  const reply = await deps.generate(
    `Research question: ${question}\n\nGathered so far:\n${digest}\n\n` +
      `If there is a real gap, reply with 1-2 new sub-queries (numbered). ` +
      `If the question is sufficiently covered, reply with exactly "none".`,
  );
  const trimmed = reply.trim().toLowerCase();
  if (!trimmed || trimmed === "none" || trimmed.startsWith("none")) return [];
  return parseQueryList(reply).slice(0, max);
}
