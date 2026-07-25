// vaultground — ground an answer against vault notes (dc-4.5). PURE retrieval core: given a query
// and a set of notes, return the top-K most relevant notes with a citation snippet, scored by
// term-overlap (a small, dependency-free BM25-lite). MISS ≠ PASS: when nothing overlaps, it returns
// an empty set and `grounded:false` — it never invents a citation. The bin does the IO (reads the
// vault); the server module is a thin re-export. Kept out of the live :3000 server on purpose.

export interface Note {
  path: string;
  text: string;
}
export interface Citation {
  path: string;
  score: number;
  snippet: string;
}
export interface Grounding {
  grounded: boolean;
  citations: Citation[];
  query: string;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on", "ve", "bir", "bu", "ne", "mi"]);

/** Content terms of a string: lowercased, folded, ≥3 chars, non-stopword, deduped. */
export function terms(s: string): string[] {
  const seen = new Set<string>();
  for (const w of String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)) {
    if (w.length >= 3 && !STOP.has(w)) seen.add(w);
  }
  return [...seen];
}

/** A short snippet around the first query-term hit (or the note's head). */
function snippet(text: string, qterms: string[], width = 160): string {
  const lc = text.toLowerCase();
  let at = -1;
  for (const t of qterms) { const i = lc.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = at < 0 ? 0 : Math.max(0, at - 40);
  return text.slice(start, start + width).replace(/\s+/g, " ").trim();
}

/**
 * Ground `query` against `notes`. Score = number of DISTINCT query terms present in the note,
 * weighted by rarity (a term in fewer notes counts more — the BM25-lite idea). Returns the top-K
 * with score > 0. `grounded` is false when no note matched (honest no-answer, MISS ≠ PASS).
 */
export function groundQuery(query: string, notes: Note[], topK = 3): Grounding {
  const q = terms(query);
  if (!q.length || !notes.length) return { grounded: false, citations: [], query };

  // document frequency per query term (for rarity weighting)
  const df: Record<string, number> = {};
  const noteTerms = notes.map((n) => new Set(terms(n.text)));
  for (const t of q) df[t] = noteTerms.reduce((n, set) => n + (set.has(t) ? 1 : 0), 0);

  const scored = notes.map((n, i) => {
    let score = 0;
    for (const t of q) if (noteTerms[i].has(t)) score += Math.log(1 + notes.length / (1 + df[t]));
    return { path: n.path, score: Number(score.toFixed(3)), snippet: snippet(n.text, q) };
  }).filter((c) => c.score > 0);

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const citations = scored.slice(0, topK);
  return { grounded: citations.length > 0, citations, query };
}

/** One-line report for the CLI/log. */
export function renderGrounding(g: Grounding): string {
  if (!g.grounded) return `"${g.query}" → GROUNDING YOK (kaynak eşleşmedi)`;
  return `"${g.query}" → ${g.citations.length} kaynak: ${g.citations.map((c) => `${c.path} (${c.score})`).join(", ")}`;
}
