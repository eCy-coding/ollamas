#!/usr/bin/env node
// scripts/eval-rerank.mjs — B6: measures the B5 rerank uplift (server/rerank.ts) on a small
// committed fixture (eval/fixtures/rerank-fixture.json — ~10 queries x ~8 candidate passages
// each, one known-relevant passage per query).
//
// Computes MRR@5 (Mean Reciprocal Rank, cutoff 5) twice:
//   • OFF — the fixture's candidate order as-is (simulates raw vector-search order)
//   • ON  — reordered by rerankCandidates() using the REAL cross-encoder (defaultScorer,
//           Xenova/bge-reranker-base via transformers.js) — downloads ONNX weights on first run
//
// This is a MANUAL / live-only harness — it downloads a real model, so it is intentionally
// NOT part of `vitest run` (mirrors server/rerank.test.ts's RUN_LIVE_E2E-gated live case, but
// as a standalone script rather than a gated unit test). Run: `make eval-rerank` or
// `npx tsx scripts/eval-rerank.mjs`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rerankCandidates, defaultScorer } from "../server/rerank.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CUTOFF = 5;

/** Reciprocal rank of `relevantId` within the first `cutoff` entries of `ids` (0 if absent). */
function reciprocalRank(ids, relevantId, cutoff) {
  const idx = ids.slice(0, cutoff).indexOf(relevantId);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

function mrrAt(cases, cutoff, orderOf) {
  const scores = cases.map((c) => reciprocalRank(orderOf(c).map((x) => x.id), c.relevantId, cutoff));
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

async function main() {
  const fixturePath = join(ROOT, "eval/fixtures/rerank-fixture.json");
  /** @type {Array<{id: string, query: string, relevantId: string, candidates: {id: string, text: string}[]}>} */
  const cases = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (cases.length === 0) throw new Error("rerank fixture is empty");

  console.log(`[eval-rerank] ${cases.length} queries, cutoff=${CUTOFF}, fixture=${fixturePath}`);

  // OFF: fixture order == "vector search" baseline, no rerank invoked.
  const mrrOff = mrrAt(cases, CUTOFF, (c) => c.candidates);

  // ON: real cross-encoder rerank (downloads Xenova/bge-reranker-base on first call).
  const reranked = [];
  for (const c of cases) {
    const ordered = await rerankCandidates(c.query, c.candidates, { scorer: defaultScorer });
    reranked.push({ ...c, ordered });
  }
  const mrrOn = mrrAt(reranked, CUTOFF, (c) => c.ordered);

  const delta = mrrOn - mrrOff;
  console.log(`\nMRR@${CUTOFF} rerank OFF: ${mrrOff.toFixed(4)}`);
  console.log(`MRR@${CUTOFF} rerank ON:  ${mrrOn.toFixed(4)}`);
  console.log(`delta (ON - OFF):    ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`);
}

main().catch((err) => {
  console.error(`[eval-rerank] failed: ${err?.stack ?? err}`);
  process.exit(1);
});
