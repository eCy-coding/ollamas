// server/embed-catalog.ts — free-tier EMBEDDING provider catalog (pure, zero-dep).
// Mirrors provider-catalog.ts: every entry is an OpenAI-compat `POST /embeddings`
// endpoint reached via fetch. Selection is PINNED via EMBED_PROVIDER — one provider per
// RAG index, never per-call rotation: the vec0 table is created with the first vector's
// dimension (rag.ts) and different models emit different dims, so rotation corrupts the
// index. gemini/cloudflare reuse the chat-catalog env keys (one signup, two modalities).

export interface EmbedCatalogEntry {
  id: string;
  /** OpenAI-compat base URL; may contain `{account_id}` (cloudflare) — resolve via embedBaseUrl. */
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  /** Output dimension of the default model (documentation; the store measures the real one). */
  dims: number;
  /** Human note for docs/UI — free-quota order of magnitude (July 2026). */
  freeQuota: string;
}

export const EMBED_CATALOG: Record<string, EmbedCatalogEntry> = {
  voyage: {
    id: "voyage",
    baseUrl: "https://api.voyageai.com/v1",
    envKey: "VOYAGE_API_KEY",
    defaultModel: "voyage-3.5-lite",
    dims: 1024,
    freeQuota: "200M tokens free (rerankers included)",
  },
  jina: {
    id: "jina",
    baseUrl: "https://api.jina.ai/v1",
    envKey: "JINA_API_KEY",
    defaultModel: "jina-embeddings-v3",
    dims: 1024,
    freeQuota: "10M tokens free (same key: reranker + r.jina.ai Reader)",
  },
  gemini: {
    id: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-embedding-001",
    dims: 3072,
    freeQuota: "100 rpm / 1,000 rpd free",
  },
  cloudflare: {
    id: "cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    envKey: "CLOUDFLARE_API_TOKEN",
    defaultModel: "@cf/baai/bge-m3",
    dims: 1024,
    freeQuota: "shares the 10K neurons/day pool",
  },
};

export function embedCatalogEntry(id: string): EmbedCatalogEntry | undefined {
  return EMBED_CATALOG[id];
}

/** Resolve the entry's base URL; cloudflare needs CLOUDFLARE_ACCOUNT_ID. Missing → "" (caller
 *  treats as not-configured). Same contract as provider-catalog.catalogBaseUrl. */
export function embedBaseUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const e = EMBED_CATALOG[id];
  if (!e) return "";
  if (!e.baseUrl.includes("{account_id}")) return e.baseUrl;
  const acct = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  return acct ? e.baseUrl.replace("{account_id}", acct) : "";
}

/** The pinned embed provider, or null for the local ollama default. Null when: no
 *  EMBED_PROVIDER, pin is local/unknown, key absent, or cloudflare lacks its account id —
 *  every null lands on the always-available local nomic embedder (terminal tier). */
export function pickEmbedProvider(env: NodeJS.ProcessEnv = process.env): EmbedCatalogEntry | null {
  const pin = (env.EMBED_PROVIDER || "").trim();
  if (!pin || pin === "local" || pin === "ollama-local") return null;
  const e = EMBED_CATALOG[pin];
  if (!e) return null;
  if (!(env[e.envKey] || "").trim()) return null;
  if (!embedBaseUrl(e.id, env)) return null;
  return e;
}

/** OpenAI-compat embeddings request (pure). */
export function buildEmbedRequest(
  entry: EmbedCatalogEntry,
  texts: string[],
  apiKey: string,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: `${embedBaseUrl(entry.id, env)}/embeddings`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: entry.defaultModel, input: texts }),
  };
}

/** Parse an OpenAI-compat embeddings response into vectors ordered by index. Throws on
 *  malformed/empty payloads so the caller can fall back honestly instead of indexing junk. */
export function parseEmbedResponse(json: any): number[][] {
  const data = json?.data;
  if (!Array.isArray(data) || data.length === 0) throw new Error("embeddings response: missing data[]");
  const rows = [...data].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
  return rows.map((r) => {
    const v = r?.embedding;
    if (!Array.isArray(v) || v.length === 0) throw new Error("embeddings response: empty vector");
    return v as number[];
  });
}
