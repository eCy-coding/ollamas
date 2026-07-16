// B5 — cross-encoder rerank stage (RAG quality upgrade). Pure ordering logic is
// deterministic via an injected fake `scorer` (no ONNX model, no network). The
// real transformers.js cross-encoder (Xenova/bge-reranker-base) is exercised
// only under RUN_LIVE_E2E=1, mirroring server/brain.test.ts's live-gate pattern.
import { describe, test, expect, vi } from "vitest";
import { rerankCandidates, defaultScorer, DEFAULT_RERANK_MODEL, type Scorer } from "./rerank";

interface Doc {
  id: string;
  text: string;
  distance: number;
}

const docs: Doc[] = [
  { id: "a", text: "alpha", distance: 0.1 },
  { id: "b", text: "bravo", distance: 0.2 },
  { id: "c", text: "charlie", distance: 0.3 },
];

// Deterministic fake scorer: score = reverse of input order, so the ranking
// flips completely relative to the incoming (distance-sorted) order.
const reverseScorer: Scorer = async (_query, texts) => texts.map((_t, i) => i);

describe("rerankCandidates — ordering", () => {
  test("reorders candidates by injected scorer, descending score", async () => {
    const out = await rerankCandidates("q", docs, { scorer: reverseScorer });
    expect(out.map((d) => d.id)).toEqual(["c", "b", "a"]); // last-scored-highest wins
  });

  test("preserves candidate fields (not just id) after reordering", async () => {
    const out = await rerankCandidates("q", docs, { scorer: reverseScorer });
    expect(out[0]).toEqual(docs[2]);
  });

  test("empty candidates → empty result, scorer never called", async () => {
    const scorer = vi.fn(async () => []);
    const out = await rerankCandidates("q", [], { scorer });
    expect(out).toEqual([]);
    expect(scorer).not.toHaveBeenCalled();
  });
});

describe("rerankCandidates — topN clamp", () => {
  test("topN < candidates.length clamps the result", async () => {
    const out = await rerankCandidates("q", docs, { scorer: reverseScorer, topN: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.id)).toEqual(["c", "b"]);
  });

  test("topN >= candidates.length returns all candidates", async () => {
    const out = await rerankCandidates("q", docs, { scorer: reverseScorer, topN: 50 });
    expect(out).toHaveLength(3);
  });

  test("topN omitted returns all candidates, reordered", async () => {
    const out = await rerankCandidates("q", docs, { scorer: reverseScorer });
    expect(out).toHaveLength(3);
  });
});

describe("rerankCandidates — graceful fallback on scorer failure", () => {
  test("scorer throws → original order returned, never throws", async () => {
    const failingScorer: Scorer = async () => {
      throw new Error("model load failed: ENOTFOUND huggingface.co");
    };
    const out = await rerankCandidates("q", docs, { scorer: failingScorer });
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]); // untouched, distance order
  });

  test("scorer returns wrong-length array → treated as failure, original order kept", async () => {
    const badScorer: Scorer = async () => [1, 2]; // 2 scores for 3 candidates
    const out = await rerankCandidates("q", docs, { scorer: badScorer });
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  test("scorer failure + topN still clamps the fallback order", async () => {
    const failingScorer: Scorer = async () => {
      throw new Error("boom");
    };
    const out = await rerankCandidates("q", docs, { scorer: failingScorer, topN: 1 });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("rerankCandidates — RAG_RERANK=0 disables reranking", () => {
  test("disabled: scorer never invoked, original order passed through", async () => {
    const scorer = vi.fn(reverseScorer);
    const out = await rerankCandidates("q", docs, { scorer, env: { RAG_RERANK: "0" } as NodeJS.ProcessEnv });
    expect(scorer).not.toHaveBeenCalled();
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  test("disabled: topN clamp still applies", async () => {
    const out = await rerankCandidates("q", docs, {
      scorer: reverseScorer,
      env: { RAG_RERANK: "0" } as NodeJS.ProcessEnv,
      topN: 1,
    });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });
});

// Live: real transformers.js cross-encoder (downloads Xenova/bge-reranker-base
// ONNX weights on first call). Opt-in only — never runs in the default gate.
describe("rerankCandidates — live cross-encoder", () => {
  test.skipIf(process.env.RUN_LIVE_E2E !== "1")(
    "real model ranks an obviously-relevant doc above an irrelevant one",
    async () => {
      const query = "What is the capital of France?";
      const candidates = [
        { id: "irrelevant", text: "Bananas are a good source of potassium.", distance: 0.5 },
        { id: "relevant", text: "Paris is the capital and most populous city of France.", distance: 0.6 },
      ];
      const out = await rerankCandidates(query, candidates, { scorer: defaultScorer });
      expect(out[0].id).toBe("relevant");
    },
    120_000,
  );

  test("DEFAULT_RERANK_MODEL is a transformers.js-compatible model id", () => {
    expect(DEFAULT_RERANK_MODEL).toMatch(/\//); // "org/model" shape
  });
});
