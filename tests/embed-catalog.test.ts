// T2-F1 — embedding provider harness: pure catalog + pinned-provider selection
// (EMBED_PROVIDER env; dims consistency forbids per-call rotation), OpenAI-compat
// request/response shapes, resolveEmbedder cloud→local fallback, and the RAG store's
// embed_provider consistency guard.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMBED_CATALOG,
  embedBaseUrl,
  pickEmbedProvider,
  buildEmbedRequest,
  parseEmbedResponse,
} from "../server/embed-catalog";
import { createRagStore, resolveEmbedder } from "../server/rag";

const IDS = ["voyage", "jina", "gemini", "cloudflare"];

describe("EMBED_CATALOG — pure data", () => {
  it("contains the 4 planned providers, internally consistent", () => {
    expect(Object.keys(EMBED_CATALOG).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const e = EMBED_CATALOG[id];
      expect(e.id).toBe(id);
      expect(e.baseUrl).toMatch(/^https:\/\//);
      expect(e.envKey).toMatch(/^[A-Z0-9_]+$/);
      expect(e.defaultModel.length).toBeGreaterThan(0);
      expect(e.dims).toBeGreaterThan(0);
    }
  });

  it("gemini/cloudflare reuse the chat-catalog env keys (one signup covers both modalities)", () => {
    expect(EMBED_CATALOG.gemini.envKey).toBe("GEMINI_API_KEY");
    expect(EMBED_CATALOG.cloudflare.envKey).toBe("CLOUDFLARE_API_TOKEN");
  });

  it("embedBaseUrl: cloudflare composes account id; missing id → empty", () => {
    expect(embedBaseUrl("cloudflare", { CLOUDFLARE_ACCOUNT_ID: "a1" } as any)).toContain("/accounts/a1/");
    expect(embedBaseUrl("cloudflare", {} as any)).toBe("");
    expect(embedBaseUrl("voyage", {} as any)).toBe("https://api.voyageai.com/v1");
  });
});

describe("pickEmbedProvider — EMBED_PROVIDER pin (never per-call rotation)", () => {
  it("no pin → null (local nomic default)", () => {
    expect(pickEmbedProvider({} as any)).toBeNull();
  });
  it("pin + key present → entry; pin without key → null (falls local, honest)", () => {
    expect(pickEmbedProvider({ EMBED_PROVIDER: "voyage", VOYAGE_API_KEY: "vk" } as any)?.id).toBe("voyage");
    expect(pickEmbedProvider({ EMBED_PROVIDER: "voyage" } as any)).toBeNull();
  });
  it("pin local/unknown → null", () => {
    expect(pickEmbedProvider({ EMBED_PROVIDER: "ollama-local" } as any)).toBeNull();
    expect(pickEmbedProvider({ EMBED_PROVIDER: "nope", NOPE_KEY: "x" } as any)).toBeNull();
  });
  it("cloudflare pin needs BOTH token and account id", () => {
    expect(pickEmbedProvider({ EMBED_PROVIDER: "cloudflare", CLOUDFLARE_API_TOKEN: "t" } as any)).toBeNull();
    expect(pickEmbedProvider({ EMBED_PROVIDER: "cloudflare", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" } as any)?.id).toBe("cloudflare");
  });
});

describe("buildEmbedRequest / parseEmbedResponse — OpenAI-compat /embeddings", () => {
  it("request: url, bearer, {model, input[]}", () => {
    const req = buildEmbedRequest(EMBED_CATALOG.voyage, ["a", "b"], "vk", {} as any);
    expect(req.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(req.headers.Authorization).toBe("Bearer vk");
    expect(JSON.parse(req.body)).toEqual({ model: "voyage-3.5-lite", input: ["a", "b"] });
  });
  it("response: vectors ordered by index, malformed → throw", () => {
    const out = parseEmbedResponse({ data: [
      { index: 1, embedding: [3, 4] },
      { index: 0, embedding: [1, 2] },
    ] });
    expect(out).toEqual([[1, 2], [3, 4]]);
    expect(() => parseEmbedResponse({})).toThrow();
    expect(() => parseEmbedResponse({ data: [{ index: 0, embedding: [] }] })).toThrow();
  });
});

describe("resolveEmbedder — pinned cloud with local terminal fallback", () => {
  // F0 (brain-encoder/v1): resolveEmbedder now returns a CONTRACT embedder — nomic task
  // prefix by role — and a providerId that fingerprints the whole geometry rather than the
  // bare provider name. Storage normalization is OFF by default (measured: MRR 0.8771 raw
  // vs 0.3823 unit-normalized); cosine is computed explicitly downstream instead.
  it("no pin → local embedder used directly, contract-wrapped", async () => {
    const local = async () => [0.5, 0.5];
    const r = resolveEmbedder({} as any, { localEmbed: local });
    expect(r.providerId).toBe("ollama-local:nomic-embed-text@localhost:11434/prefix=nomic-v1/norm=none");
    // norm=none by default: eval-brain-mrr measured 0.8771 raw vs 0.3823 unit-normalized
    expect(await r.embed("x")).toEqual([0.5, 0.5]);
  });

  it("providerId changes when the embedding geometry changes", async () => {
    // The pre-F0 pin was the constant "ollama-local", so a prefix-policy change left it
    // identical and brain.ts ensureProvider() could not detect the split space.
    const nomic = resolveEmbedder({} as any, { localEmbed: async () => [1] }).providerId;
    const other = resolveEmbedder({ OLLAMA_EMBED_MODEL: "mxbai-embed-large" } as any, { localEmbed: async () => [1] }).providerId;
    expect(nomic).not.toBe(other);
    expect(nomic).toContain("prefix=nomic-v1");
    expect(other).toContain("prefix=none");
  });

  it("applies the nomic task prefix per role", async () => {
    const seen: string[] = [];
    const r = resolveEmbedder({} as any, { localEmbed: async (t: string) => { seen.push(t); return [1, 0]; } });
    await r.embed("hello", "document");
    await r.embed("hello", "query");
    expect(seen).toEqual(["search_document: hello", "search_query: hello"]);
  });

  it("pinned cloud success → cloud vector (normalized); providerId fingerprints the pin", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [0, 3, 4] }] }), { status: 200 })) as typeof fetch;
    const r = resolveEmbedder({ EMBED_PROVIDER: "jina", JINA_API_KEY: "jk" } as any, { fetchFn, localEmbed: async () => [9] });
    expect(r.providerId).toContain("jina:");
    expect(r.providerId).toContain("/norm=none");
    expect(await r.embed("hello")).toEqual([0, 3, 4]);
  });

  it("pinned cloud failure → falls to local (terminal fallback never removed)", async () => {
    const fetchFn = (async () => new Response("quota", { status: 429 })) as typeof fetch;
    const r = resolveEmbedder({ EMBED_PROVIDER: "jina", JINA_API_KEY: "jk" } as any, { fetchFn, localEmbed: async () => [7, 7] });
    expect(await r.embed("hello")).toEqual([7, 7]);
  });

  it("fallback does not double-prefix (cloud model non-nomic, local model nomic)", async () => {
    const seen: string[] = [];
    const fetchFn = (async () => new Response("quota", { status: 429 })) as typeof fetch;
    const r = resolveEmbedder(
      { EMBED_PROVIDER: "jina", JINA_API_KEY: "jk" } as any,
      { fetchFn, localEmbed: async (t: string) => { seen.push(t); return [1, 0]; } },
    );
    await r.embed("hello", "document");
    expect(seen).toEqual(["search_document: hello"]);
  });
});

describe("RAG store — embed_provider consistency guard", () => {
  it("store indexed under provider A refuses provider B (dims corruption prevention)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rag-embed-"));
    const dbPath = join(dir, "rag.db");
    const a = createRagStore({ dbPath, embed: async () => [1, 0, 0], embedProvider: "voyage" });
    await a.index("d1", "text one");
    a.close();
    const b = createRagStore({ dbPath, embed: async () => [0, 1, 0], embedProvider: "jina" });
    await expect(b.index("d2", "text two")).rejects.toThrow(/embed provider mismatch/i);
    await expect(b.search("q")).rejects.toThrow(/embed provider mismatch/i);
    b.close();
    // same provider reopens fine
    const c = createRagStore({ dbPath, embed: async () => [0, 0, 1], embedProvider: "voyage" });
    await expect(c.search("q")).resolves.toBeTruthy();
    c.close();
  });
});
