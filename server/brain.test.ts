// Brain v1 (Tur 4) — tiered semantic memory + bi-temporal facts on the rag.ts
// sqlite-vec pattern (agentmem tier blueprint + graphiti valid_from/invalidated_at
// edges). Deterministic via a FAKE embedder; live ollama path is RUN_LIVE_E2E-gated.
// Flows through the ToolRegistry choke-point like rag_index/rag_search.
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { createBrainStore, parseExtraction, TIER_WEIGHT } from "./brain";

// 3-dim fake embedder with predictable KNN ordering (rag.e2e.test.ts convention).
const VECTORS: Record<string, number[]> = {
  "likes espresso": [1, 0, 0],
  "prefers tea": [0.9, 0.1, 0],
  "deploy uses make ship": [0, 1, 0],
  query_coffee: [1, 0, 0],
};
const fakeEmbed = async (t: string) => VECTORS[t] ?? [0, 0, 1];

const tmpDb = () => path.join(os.tmpdir(), `ollamas-brain-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);

describe("Brain — tiered memories (sqlite-vec)", () => {
  test("remember + recall orders by distance, then tier weight breaks ties", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    // Same vector distance would tie — tier weight must rank core above working.
    await b.remember({ id: "m-work", tier: "working", content: "likes espresso" });
    await b.remember({ id: "m-core", tier: "core", content: "likes espresso" });
    await b.remember({ id: "m-far", tier: "core", content: "deploy uses make ship" });
    const hits = await b.recall("query_coffee", { k: 3 });
    expect(hits[0].id).toBe("m-core"); // tier weight beats equal distance
    expect(hits[1].id).toBe("m-work");
    expect(hits[2].id).toBe("m-far"); // distance dominates tier
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    b.close();
  });

  test("tier filter + namespace isolation", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m1", tier: "learned", content: "likes espresso" });
    await b.remember({ id: "m2", tier: "episodic", content: "prefers tea" });
    await b.remember({ id: "m3", tier: "learned", content: "likes espresso", ns: "tenant-b" });
    const learnedOnly = await b.recall("query_coffee", { k: 5, tier: "learned" });
    expect(learnedOnly.map((h) => h.id)).toEqual(["m1"]); // m3 lives in another ns
    const tenantB = await b.recall("query_coffee", { k: 5, ns: "tenant-b" });
    expect(tenantB.map((h) => h.id)).toEqual(["m3"]);
    b.close();
  });

  test("re-remember same id upserts (no duplicates)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m1", tier: "working", content: "likes espresso" });
    await b.remember({ id: "m1", tier: "core", content: "prefers tea" });
    const hits = await b.recall("query_coffee", { k: 5 });
    expect(hits.filter((h) => h.id === "m1")).toHaveLength(1);
    expect(hits[0].tier).toBe("core");
    b.close();
  });
});

describe("Brain — bi-temporal facts (graphiti pattern)", () => {
  test("asserting a changed fact invalidates the old one; point-in-time query sees history", async () => {
    let t = 1000;
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, now: () => t });
    const r1 = await b.assertFact({ subject: "emre", predicate: "prefers_provider", object: "groq" });
    expect(r1.changed).toBe(true);
    t = 2000;
    const r2 = await b.assertFact({ subject: "emre", predicate: "prefers_provider", object: "cerebras" });
    expect(r2.changed).toBe(true);
    expect(r2.invalidated).toBe(1);

    const nowFacts = b.factsAbout("emre");
    expect(nowFacts).toHaveLength(1);
    expect(nowFacts[0].object).toBe("cerebras");

    const then = b.factsAbout("emre", { at: 1500 });
    expect(then).toHaveLength(1);
    expect(then[0].object).toBe("groq");
    b.close();
  });

  test("re-asserting the identical fact is a no-op", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.assertFact({ subject: "ollamas", predicate: "port", object: "3000" });
    const again = await b.assertFact({ subject: "ollamas", predicate: "port", object: "3000" });
    expect(again.changed).toBe(false);
    expect(b.factsAbout("ollamas")).toHaveLength(1);
    b.close();
  });
});

describe("Brain — batch ingest (agent-distilled episodes)", () => {
  test("ingest persists memories + facts under the episode id", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    const out = await b.ingest({
      episodeId: "sess-42",
      memories: [
        { tier: "episodic", content: "likes espresso" },
        { tier: "learned", content: "deploy uses make ship" },
      ],
      facts: [{ subject: "emre", predicate: "drinks", object: "espresso" }],
    });
    expect(out.memories).toBe(2);
    expect(out.facts).toBe(1);
    const hits = await b.recall("query_coffee", { k: 5 });
    expect(hits.some((h) => h.id === "sess-42:m0")).toBe(true);
    expect(b.factsAbout("emre")[0].episodeId).toBe("sess-42");
    b.close();
  });

  test("stats reports per-tier and fact counts", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "a", tier: "core", content: "likes espresso" });
    await b.remember({ id: "b", tier: "core", content: "prefers tea" });
    await b.assertFact({ subject: "s", predicate: "p", object: "o" });
    const s = b.stats();
    expect(s.memories.core).toBe(2);
    expect(s.facts).toBe(1);
    b.close();
  });
});

describe("Brain — extraction parsing (reasoning-leakage safe)", () => {
  test("parseExtraction takes the LAST JSON object out of prose", () => {
    const raw = 'Thinking: user wants {"memories": []}… here:\n{"memories":[{"tier":"learned","content":"x"}],"facts":[{"subject":"a","predicate":"b","object":"c"}]}';
    const out = parseExtraction(raw);
    expect(out.memories).toHaveLength(1);
    expect(out.facts?.[0].object).toBe("c");
  });

  test("parseExtraction rejects junk tiers and drops malformed rows instead of throwing", () => {
    const out = parseExtraction('{"memories":[{"tier":"nonsense","content":"x"},{"tier":"core","content":"ok"},{"content":"no tier"}],"facts":[{"subject":"a"}]}');
    expect(out.memories).toEqual([{ tier: "core", content: "ok" }]);
    expect(out.facts).toEqual([]);
  });
});

describe("Brain — choke-point wiring", () => {
  test("tool tiers: writes host, reads safe", async () => {
    const { ToolRegistry } = await import("./tool-registry");
    expect(ToolRegistry.tier("brain_remember")).toBe("host");
    expect(ToolRegistry.tier("brain_ingest")).toBe("host");
    expect(ToolRegistry.tier("brain_fact_assert")).toBe("host");
    expect(ToolRegistry.tier("brain_recall")).toBe("safe");
    expect(ToolRegistry.tier("brain_facts")).toBe("safe");
  });

  test("brain_recall on an empty store returns [] without an embedder call", async () => {
    process.env.BRAIN_DB_PATH = tmpDb();
    const { ToolRegistry } = await import("./tool-registry");
    const out = await ToolRegistry.execute(
      "brain_recall",
      { query: "anything" },
      { isLive: false, workspaceRoot: ".", autoApply: true, deps: {} as any },
    );
    expect(out.ok).toBe(true);
    expect(out.output.results).toEqual([]);
    delete process.env.BRAIN_DB_PATH;
  });
});

// Live: real ollama embeddings (needs `ollama pull nomic-embed-text`). Opt-in.
describe("Brain — live embeddings", () => {
  test.skipIf(process.env.RUN_LIVE_E2E !== "1")(
    "real embeddings remember + recall round-trip",
    async () => {
      const b = createBrainStore({ dbPath: tmpDb() });
      await b.remember({ id: "l1", tier: "learned", content: "The pre-commit gate runs tsc, lint and the full vitest suite." });
      await b.remember({ id: "l2", tier: "learned", content: "Pollinations serves anonymous traffic on the text host." });
      const hits = await b.recall("which host serves keyless pollinations requests?", { k: 1 });
      expect(hits[0].id).toBe("l2");
      b.close();
    },
    60000,
  );
});

// TIER_WEIGHT is part of the public contract — recall maths depend on the order.
describe("Brain — tier weights", () => {
  test("core > learned > procedural > episodic > working", () => {
    expect(TIER_WEIGHT.core).toBeGreaterThan(TIER_WEIGHT.learned);
    expect(TIER_WEIGHT.learned).toBeGreaterThan(TIER_WEIGHT.procedural);
    expect(TIER_WEIGHT.procedural).toBeGreaterThan(TIER_WEIGHT.episodic);
    expect(TIER_WEIGHT.episodic).toBeGreaterThan(TIER_WEIGHT.working);
  });
});

describe("Brain — overview resilience (degrade-alive health)", () => {
  test("overview ships SQL-only bundle with degraded health when the embedder hangs", async () => {
    // Health's drift probe embeds fresh (cache bypass by design) — a busy embedder
    // must degrade the health field, never take stats/memories/facts down with it.
    let hang = false;
    const embed = async (t: string) => (hang ? new Promise<number[]>(() => {}) : VECTORS[t] ?? [0, 0, 1]);
    const b = createBrainStore({ dbPath: tmpDb(), embed });
    await b.remember({ id: "m-l", tier: "learned", content: "likes espresso" });
    hang = true;
    process.env.BRAIN_HEALTH_TIMEOUT_MS = "200";
    try {
      const started = performance.now();
      const o = await b.overview({ recent: 5 });
      expect(performance.now() - started).toBeLessThan(3000);
      expect(o.stats.memories.learned).toBe(1);
      expect(o.memories.map((m) => m.id)).toEqual(["m-l"]);
      expect(o.health.degraded).toBe(true);
      expect(o.health.drift).toBe(false); // a timed-out probe is not evidence of drift
    } finally {
      delete process.env.BRAIN_HEALTH_TIMEOUT_MS;
      b.close();
    }
  });

  test("overview keeps real health when the embedder answers in time", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m-l", tier: "learned", content: "likes espresso" });
    const o = await b.overview({ recent: 5 });
    expect(o.health.degraded).toBeUndefined();
    expect(o.health.probes).toBe(1);
    expect(o.health.selfHitRate).toBe(1);
    b.close();
  });
});
