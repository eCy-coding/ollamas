// F0 — the shared encoder contract, `brain-encoder/v1`.
//
// ollamas, eCym (~/.local/bin/ecy-brain) and odysseus (app/src/embeddings.py) all
// embed with nomic-embed-text/768d, but until F0 they did NOT share a vector space:
// eCym applied nomic's task prefixes and L2-normalized; ollamas did neither; odysseus
// had silently fallen back to 384d fastembed because its configured :11436 has no
// listener. Any cross-system score comparison (federated merge, p_ret softmax) is
// meaningless unless all three agree on prefix policy + normalization.
//
// This module is the single source of truth for that agreement. Pure functions only —
// no fetch, no db — so the contract is unit-testable without ollama.
import { normalizeVector } from "./semantic-cache";

/** Bump when the wire format changes (prefix strings, normalization, dim policy).
 *  eCym stamps this into brain.vec.json and odysseus into its lane fingerprint, so a
 *  drifting system is detectable instead of silently mis-ranked. */
export const EMBED_CONTRACT = "brain-encoder/v1";

/** Which side of the retrieval pair a text sits on. nomic-embed-text is trained with
 *  asymmetric task prefixes; using the wrong one degrades recall measurably. */
export type EmbedRole = "document" | "query";

export type PrefixPolicy = "nomic-v1" | "none";

const NOMIC_PREFIX: Record<EmbedRole, string> = {
  document: "search_document: ",
  query: "search_query: ",
};

/** nomic ships as `nomic-embed-text`, `nomic-embed-text:latest`, `nomic-embed-text:v1.5`
 *  across the three systems — match the family, not an exact tag. */
export function prefixPolicyFor(model: string, env: NodeJS.ProcessEnv = process.env): PrefixPolicy {
  // Diagnostic switch: the prefix is a RETRIEVAL-QUALITY choice, not a correctness one,
  // so it must be A/B-testable against eval-brain-mrr rather than asserted. It is part
  // of the fingerprint, so flipping it forces a re-embed instead of silently mixing.
  if (env.BRAIN_EMBED_PREFIX === "0") return "none";
  return /(^|\/)nomic-embed-text(:|$)/.test(model.trim()) ? "nomic-v1" : "none";
}

/** Stored-vector normalization. DEFAULT OFF — measured, not assumed.
 *
 *  `make eval-brain-mrr` over eval/brain-mrr-fixture.json, 16 queries, k=5:
 *
 *      prefix=nomic-v1 norm=l2    MRR 0.3823
 *      prefix=none     norm=l2    MRR 0.4375
 *      prefix=nomic-v1 norm=none  MRR 0.8771   ← default
 *      prefix=none     norm=none  MRR 0.8562   (pre-F0 baseline)
 *
 *  Storing unit vectors more than halves retrieval quality. brain.ts ranks by
 *  1/(1+L2) and sqlite-vec KNN orders by L2, so the vector MAGNITUDE carries signal
 *  that normalization discards.
 *
 *  This does NOT block the cosine-based formulas. Storage normalization and cosine
 *  COMPUTABILITY are separable: cos(q,d) = q·d/(‖q‖‖d‖) is scale-invariant in d, so
 *  p_ret can divide by the norms on demand and get exact cosine from raw vectors.
 *  Cross-store comparability likewise needs cosine, not normalized storage — eCym may
 *  keep storing unit vectors and still compare identically. */
export function normPolicy(env: NodeJS.ProcessEnv = process.env): "l2" | "none" {
  return env.BRAIN_EMBED_NORM === "1" ? "l2" : "none";
}

/** Prepend the role's task prefix when the model calls for one. Idempotent: re-prefixing
 *  an already-prefixed string is a no-op, so a caller that cannot tell whether text has
 *  been through here cannot corrupt the vector. */
export function applyEmbedPrefix(
  text: string,
  role: EmbedRole,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (prefixPolicyFor(model, env) !== "nomic-v1") return text;
  const prefix = NOMIC_PREFIX[role];
  return text.startsWith(prefix) ? text : prefix + text;
}

/** The string a vector store pins to guarantee index consistency.
 *
 *  Pre-F0 this was the bare constant "ollama-local" (rag.ts resolveEmbedder), which
 *  encoded neither the model nor the prefix policy nor normalization. Changing prefix
 *  policy therefore left the pin identical, brain.ts ensureProvider() never threw, and
 *  the 1427 stored memories would have silently split across two incompatible spaces.
 *  Every field that changes the geometry of the output MUST appear here.
 *
 *  Dimension is deliberately absent: it is unknown until the first embed and is already
 *  guarded independently by brain.ts ensureVec(). */
export function embedFingerprint(
  o: { provider: string; model: string; host: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = o.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${o.provider}:${o.model}@${host}/prefix=${prefixPolicyFor(o.model, env)}/norm=${normPolicy(env)}`;
}

/** The part of the contract that must match ACROSS systems, as opposed to within one
 *  store. Two systems are cosine-comparable iff their vectors point the same way for
 *  the same text — which depends on the model and the prefix policy, and NOT on whether
 *  either side normalizes before storing (cosine is scale-invariant).
 *
 *  So: ollamas may store raw (MRR 0.8771) while eCym stores unit vectors, and the
 *  federated merge still compares them exactly, as long as spaceId matches. Storage
 *  normalization stays in embedFingerprint() because it DOES change L2 ranking inside
 *  a single store, which is what ensureProvider() guards. */
export function embedSpaceId(model: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${model}/prefix=${prefixPolicyFor(model, env)}`;
}

/** A raw embedder as the provider returns it — unnormalized, unprefixed.
 *  `role` is forwarded (not consumed) so wrappers can nest: rag.ts's cloud arm falls back
 *  to a already-contracted local arm, which still needs to know which prefix to apply. */
export type RawEmbedder = (text: string, role?: EmbedRole) => Promise<number[]>;

/** An embedder that honors the contract: task-prefixed by role, L2-normalized.
 *
 *  Role defaults to "query" because read paths outnumber write paths ~20:1 in this repo;
 *  the write sites (brain remember / assertFact / rag index) pass "document" explicitly.
 *  Unit-norm output is the precondition that makes dot product == cosine, which is what
 *  p_ret = softmax(cos/τ) and the federated cross-store merge both rely on. */
export function contractEmbedder(
  raw: RawEmbedder,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): (text: string, role?: EmbedRole) => Promise<number[]> {
  return async (text, role = "query") => {
    const v = await raw(applyEmbedPrefix(text, role, model, env), role);
    return normPolicy(env) === "l2" ? normalizeVector(v) : v;
  };
}
