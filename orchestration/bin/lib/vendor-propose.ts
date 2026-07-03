// vendor-propose (pure) — the producer-side logic for turning a stream into a free-tier VENDOR proposal.
//
// Why: `gemini-run --propose` falls over to the free-tier API pool when gemini's day is spent. That path must
// be RELIABLE, not demo-once: (1) which vendors a stream may use, (2) whether a model's answer is actually an
// apply-ready proposal (not empty/prose) BEFORE it's written + counted. Both are pure string logic → unit-
// tested here; the thin IO (dispatch/backoff/budget) stays in gemini-run.ts. Validation REUSES the downstream
// SR parser (`search-replace.ts`) so a proposal this producer accepts is exactly one fleet-apply can resolve —
// no producer/consumer drift.

import { STREAMS, type StreamSpec } from "./fleet-plan";
import { hasSearchReplace } from "./search-replace";

/** A stream's free-tier API-worker candidates (its `provider::model` prefer-tails), in preference order,
 *  de-duplicated by vendor (first model per vendor wins). Bare ollama/gemini tags are not API workers. */
export function apiVendorCandidates(stream: string, streams: StreamSpec[] = STREAMS): { vendor: string; model: string }[] {
  const spec = streams.find((s) => s.id === stream);
  if (!spec) return [];
  const seen = new Set<string>();
  const out: { vendor: string; model: string }[] = [];
  for (const p of spec.prefer) {
    const [vendor, model] = p.split("::"); // "provider::model" — split, not slice (delimiter is 2 chars)
    if (model && !seen.has(vendor)) { seen.add(vendor); out.push({ vendor, model }); }
  }
  return out;
}

/** Is `text` an apply-ready proposal? Must contain a real SEARCH/REPLACE block (what fleet-apply resolves) and
 *  clear the downstream minimum length — rejects empty answers, prose, and truncated bodies BEFORE they are
 *  written or counted as a spent request. Kept identical to the downstream gate to avoid producer/consumer drift. */
export function isActionableProposal(text: string): boolean {
  return typeof text === "string" && text.trim().length >= 20 && hasSearchReplace(text);
}

/** Pull the model's proposal body out of an agent-dispatch `--json` report (its `messages`, joined). Returns
 *  "" for empty/absent messages or a non-JSON blob — the caller treats "" as "no proposal from this vendor". */
export function extractProposalText(out: string): string {
  try {
    const j = JSON.parse(out);
    return Array.isArray(j.messages) ? j.messages.map(String).join("\n").trim() : "";
  } catch { return ""; }
}
