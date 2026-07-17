// Brain v2 — session distillation. Turns a chat session into durable brain writes:
// transcript → EXTRACTION_PROMPT via an injectable LLM call → parseExtraction →
// brainIngest. Pure-core + thin-IO: the LLM and the ingest sink are both injected,
// so the module tests deterministically; server.ts wires ProviderRouter.generate in.
//
// Best-effort by contract (verifier precedent, server.ts:1956): a garbage LLM reply
// distills to zero writes, it never throws into the caller.
import { EXTRACTION_PROMPT, parseExtraction, brainIngest, type Extraction, type BrainFactInput } from "./brain";

export interface DistillableSession {
  id: string;
  messages: { role: string; content?: string }[];
}

export interface DistillDeps {
  /** (messages) → assistant text. server.ts passes a ProviderRouter.generate wrapper. */
  generate(messages: { role: string; content: string }[]): Promise<string>;
  /** Injectable sink (defaults to the process-wide brain store). */
  ingest?: (batch: { episodeId: string; memories?: Extraction["memories"]; facts?: BrainFactInput[]; ns?: string }) => Promise<{ memories: number; facts: number }>;
  ns?: string;
}

/** Keep the transcript tail — recent turns carry the durable outcome; a hard cap
 *  keeps the distill call inside any provider's free-tier context. */
const TRANSCRIPT_CAP = 24_000;

export async function distillSession(
  sess: DistillableSession,
  deps: DistillDeps,
): Promise<{ memories: number; facts: number; skipped: boolean }> {
  const turns = (sess.messages || []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(),
  );
  if (turns.length < 2) return { memories: 0, facts: 0, skipped: true };

  const transcript = turns
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(-TRANSCRIPT_CAP);

  const raw = await deps.generate([
    { role: "system", content: EXTRACTION_PROMPT },
    { role: "user", content: transcript },
  ]);
  const extraction = parseExtraction(raw || "");
  if (extraction.memories.length === 0 && extraction.facts.length === 0) {
    return { memories: 0, facts: 0, skipped: false };
  }
  const sink = deps.ingest ?? brainIngest;
  const out = await sink({ episodeId: sess.id, ...extraction, ns: deps.ns });
  // Single-line observation record — OTel gen-ai semantic field NAMES only (no SDK dep).
  console.log(JSON.stringify({
    event: "brain.distill",
    "gen_ai.operation.name": "memory_distillation",
    "gen_ai.conversation.id": sess.id,
    memories: out.memories,
    facts: out.facts,
  }));
  return { ...out, skipped: false };
}
