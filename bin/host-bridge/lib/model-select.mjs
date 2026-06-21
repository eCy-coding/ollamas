// Efficient local-model selection (scripts lane, v17) — PURE, no fs/network.
// Extracted from benchmark.mjs's inline ranking so the choice is reusable +
// unit-testable + constraint-aware (the bench can re-run; selection can read a
// cached benchmark.json without re-benching). North Star §0-1: pick the most
// efficient local model the M4 actually proved fastest.
//
// Adopts MinhNgyuen/llm-benchmark (MIT, already in v4) correct-first + tok/s
// ranking and rockyRunnr/ollama-bench (MIT) selection idea — pure JS, zero dep.
//
// Result shape (from benchmark.mjs): { model, tok_s, total_ms, correct, ran, sizeGb? }

// Correctness ALWAYS dominates: a faster model that answers wrong is disqualified
// from the top (kept only as fallback when nothing is correct).
const correctFirst = (a, b) => Number(b.correct) - Number(a.correct);

// Rank results. metric "latency" (total_ms asc — matches benchmark.mjs default)
// or "tps" (tok_s desc). Filters are DATA-DRIVEN: a result is dropped only when
// it HAS the field and violates the bound (never guess RAM from a name → RISK-SCR-024).
// If a filter empties the pool, it is relaxed (better a ranked answer than none).
export function rankModels(results = [], { metric = "latency", minTokS = 0, maxSizeGb = 0 } = {}) {
  const pass = (r) => {
    if (minTokS && r.tok_s != null && r.tok_s < minTokS) return false;
    if (maxSizeGb && r.sizeGb != null && r.sizeGb > maxSizeGb) return false;
    return true;
  };
  const filtered = results.filter(pass);
  const pool = filtered.length ? filtered : results.slice();
  const byMetric =
    metric === "tps"
      ? (a, b) => (b.tok_s || 0) - (a.tok_s || 0)
      : (a, b) => (a.total_ms || Number.MAX_SAFE_INTEGER) - (b.total_ms || Number.MAX_SAFE_INTEGER);
  return [...pool].sort((a, b) => correctFirst(a, b) || byMetric(a, b));
}

// Pick the single most efficient model. Prefers the top CORRECT model; if none is
// correct, falls back to the top-ranked (with a reason saying so).
export function pickModel(results = [], opts = {}) {
  const ranked = rankModels(results, opts);
  const firstCorrect = ranked.find((r) => r.correct);
  const best = firstCorrect || ranked[0] || null;
  const metric = opts.metric === "tps" ? "tps" : "latency";
  let reason;
  if (!best) reason = "no models in benchmark";
  else if (firstCorrect) reason = `fastest correct by ${metric}` + (best.tok_s != null ? ` (${best.tok_s} tok/s)` : "") + (best.total_ms != null ? ` (${best.total_ms}ms total)` : "");
  else reason = "no correct model — fallback to top-ranked (re-benchmark recommended)";
  return { model: best?.model ?? null, correct: !!best?.correct, reason, metric, ranked };
}
