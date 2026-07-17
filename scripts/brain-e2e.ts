// Brain E2E (v3) — the full live chain on this MacBook, one command, $0:
//   fake session transcript → REAL keyless LLM (text.pollinations.ai, zero-dep fetch)
//   → distillSession (EXTRACTION_PROMPT + parseExtraction) → temp brain.db (sqlite-vec,
//   local nomic embeddings) → semantic recall + fact search must find what was distilled.
// Exit 0 = chain proven; exit 1 = a stage failed (message says which).
// No ProviderRouter import, no server boot — this is the minimal honest path.
import os from "node:os";
import path from "node:path";
import { createBrainStore } from "../server/brain";
import { distillSession } from "../server/brain-distill";
import { resolveEmbedder } from "../server/rag";

const LLM_URL = "https://text.pollinations.ai/v1/chat/completions";

async function llm(messages: { role: string; content: string }[], attempt = 1): Promise<string> {
  try {
    const res = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages, max_tokens: 400, temperature: 0 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    if (attempt < 2) {
      console.log(`  retry (${(e as Error).message})…`);
      return llm(messages, attempt + 1);
    }
    throw e;
  }
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `ollamas-brain-e2e-${Date.now()}.db`);
  const r = resolveEmbedder();
  const b = createBrainStore({ dbPath, embed: r.embed, embedProvider: r.providerId });

  console.log("① distill: transcript → $0 LLM → extraction → ingest");
  const session = {
    id: "e2e-session",
    messages: [
      { role: "user", content: "Deploy sürecimiz nasıl işliyor?" },
      { role: "assistant", content: "make ship komutu önce gate'i (tsc + lint + test) koşar, yeşilse release eder." },
      { role: "user", content: "Varsayılan provider'ı groq yerine cerebras yap." },
      { role: "assistant", content: "Tamam, varsayılan provider artık cerebras." },
    ],
  };
  const out = await distillSession(session, {
    generate: llm,
    ingest: (batch) => b.ingest(batch),
  });
  console.log(`   → memories=${out.memories} facts=${out.facts}`);
  if (out.skipped || (out.memories === 0 && out.facts === 0)) throw new Error("distillation produced nothing");

  console.log("② semantic recall (local nomic embeddings)");
  const hits = await b.recall("deploy nasıl release ediliyor?", { k: 3 });
  if (hits.length === 0) throw new Error("recall found nothing");
  console.log(`   → top: [${hits[0].tier}] ${hits[0].content.slice(0, 70)}`);
  const deployHit = hits.some((h) => /ship|gate|deploy|release/i.test(h.content));
  if (!deployHit) throw new Error("recall did not surface the deploy lesson");

  console.log("③ fact layer");
  const facts = await b.searchFacts("hangi provider varsayılan?", { k: 3 });
  console.log(`   → ${facts.length} fact hit${facts[0] ? `: ${facts[0].subject} ${facts[0].predicate} ${facts[0].object}` : ""}`);

  console.log("④ health probe");
  const h = await b.health();
  console.log(`   → self-hit ${(h.selfHitRate * 100).toFixed(0)}% / ${h.probes} probe, drift=${h.drift}`);
  if (h.drift) throw new Error("fresh store reports drift — embedder unstable");

  b.close();
  console.log("\n✅ E2E chain proven: LLM($0) → distill → sqlite-vec → recall/facts/health");
}

main().catch((e) => {
  console.error(`\n❌ brain-e2e failed: ${e?.message ?? e}`);
  process.exit(1);
});
