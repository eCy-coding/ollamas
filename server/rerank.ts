// B5 — local cross-encoder rerank stage (RAG quality upgrade). Ordering logic
// (rerankCandidates) is pure and takes an injectable `scorer` so it is fully
// unit-testable without ever loading a model. The default scorer lazy-loads a
// cross-encoder reranker via transformers.js (@huggingface/transformers) —
// this downloads ONNX weights on first call, so it must never run in the
// default test gate; only tests that inject a fake scorer, or the
// RUN_LIVE_E2E-gated real-model test, exercise that path (mirrors
// server/brain.test.ts's live-gate pattern for embeddings).
//
// `RAG_RERANK=0` disables reranking entirely (original vector-search order,
// still respects `topN`). Any scorer failure (model download, OOM, malformed
// output, …) is caught and logged — reranking is a quality bonus, never a
// blocker for retrieval, so it falls back to the original order instead of
// throwing (mirrors documents/service.ts's ragIndexDocument graceful-degrade
// discipline).

/** A cross-encoder scorer: given a query and a batch of candidate texts,
 *  returns one relevance score per text (higher = more relevant), in the
 *  same order as `texts`. */
export type Scorer = (query: string, texts: string[]) => Promise<number[]> | number[];

export interface RerankOptions {
  /** Max results to return. Omitted/<=0 → all candidates (reordered). */
  topN?: number;
  /** Override the scorer — required for deterministic tests. */
  scorer?: Scorer;
  env?: NodeJS.ProcessEnv;
}

/** Default cross-encoder reranker model — an ONNX conversion of BAAI's
 *  bge-reranker-base published for transformers.js. Override with
 *  RAG_RERANK_MODEL (e.g. a mxbai-rerank-* variant). */
export const DEFAULT_RERANK_MODEL = "Xenova/bge-reranker-base";

const clamp = <T>(items: T[], topN?: number): T[] => {
  if (topN === undefined || topN <= 0 || topN >= items.length) return items;
  return items.slice(0, Math.floor(topN));
};

/**
 * Reorder `candidates` by cross-encoder relevance to `query`. Pure ordering
 * logic — the actual scoring is fully delegated to `opts.scorer` (defaults to
 * the lazy-loaded transformers.js cross-encoder). `RAG_RERANK=0` (checked via
 * `opts.env`, defaulting to `process.env`) short-circuits to a passthrough
 * (still topN-clamped) without ever invoking the scorer — this is what keeps
 * unit tests network-free by default.
 */
export async function rerankCandidates<T extends { text: string }>(
  query: string,
  candidates: T[],
  opts: RerankOptions = {},
): Promise<T[]> {
  const env = opts.env ?? process.env;
  if (candidates.length === 0) return candidates;
  if (env.RAG_RERANK === "0") return clamp(candidates, opts.topN);

  const scorer = opts.scorer ?? defaultScorer;
  try {
    const scores = await scorer(query, candidates.map((c) => c.text));
    if (!Array.isArray(scores) || scores.length !== candidates.length) {
      throw new Error(
        `scorer returned ${Array.isArray(scores) ? scores.length : typeof scores} scores for ${candidates.length} candidates`,
      );
    }
    const ranked = candidates
      .map((c, i) => ({ c, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c);
    return clamp(ranked, opts.topN);
  } catch (e: any) {
    console.warn(`[RAG] rerank failed (${e?.message ?? e}) → original order`);
    return clamp(candidates, opts.topN);
  }
}

// ── Default scorer: transformers.js cross-encoder (lazy, singleton) ────────
type RerankerHandle = { tokenizer: any; model: any };
let _rerankerPromise: Promise<RerankerHandle> | null = null;

async function loadReranker(): Promise<RerankerHandle> {
  if (!_rerankerPromise) {
    _rerankerPromise = (async () => {
      const modelId = process.env.RAG_RERANK_MODEL || DEFAULT_RERANK_MODEL;
      const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(modelId),
        AutoModelForSequenceClassification.from_pretrained(modelId),
      ]);
      return { tokenizer, model };
    })();
  }
  return _rerankerPromise;
}

/** Real cross-encoder scorer. Tokenizes (query, text) pairs and reads the
 *  sequence-classification head's raw logit as the relevance score (higher =
 *  more relevant; no softmax needed since we only compare within one batch). */
export const defaultScorer: Scorer = async (query, texts) => {
  const { tokenizer, model } = await loadReranker();
  const queries = texts.map(() => query);
  const inputs = tokenizer(queries, { text_pair: texts, padding: true, truncation: true });
  const { logits } = await model(inputs);
  const data: number[] = Array.from(logits.data as ArrayLike<number>);
  const perRow = data.length / texts.length;
  const scores: number[] = [];
  for (let i = 0; i < texts.length; i++) scores.push(data[i * perRow]);
  return scores;
};
