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

describe("Brain — deferred embedding (write-behind under embedder contention)", () => {
  test("remember survives a hanging embedder: durable row, FTS-visible, backfilled by sweep", async () => {
    let hang = false;
    const embed = async (t: string) => (hang ? new Promise<number[]>(() => {}) : VECTORS[t] ?? [0, 0, 1]);
    const b = createBrainStore({ dbPath: tmpDb(), embed });
    await b.remember({ id: "m-base", tier: "learned", content: "deploy uses make ship" });
    hang = true;
    process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS = "150";
    try {
      const r = await b.remember({ id: "m-def", tier: "episodic", content: "likes espresso" });
      expect(r.deferred).toBe(true);
      hang = false;
      // Vector arm can't see it yet — the FTS arm surfaces it at neutral distance.
      const ftsHits = await b.recall("espresso", { k: 5 });
      expect(ftsHits.map((h) => h.id)).toContain("m-def");
      const swept = b.sweep();
      const backfilled = await b.backfillEmbeddings();
      expect(backfilled).toBe(1);
      // Now the vector arm ranks it by real distance (VECTORS maps it to the coffee axis).
      const vecHits = await b.recall("query_coffee", { k: 2 });
      expect(vecHits[0]?.id).toBe("m-def");
      expect(swept.swept).toBe(0);
    } finally {
      delete process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS;
      b.close();
    }
  });

  test("BRAIN_DEFER_EMBED=0 restores fail-fast writes; backfill aborts while contended", async () => {
    let hang = false;
    const embed = async (t: string) => (hang ? new Promise<number[]>(() => {}) : VECTORS[t] ?? [0, 0, 1]);
    const b = createBrainStore({ dbPath: tmpDb(), embed });
    await b.remember({ id: "m-base", tier: "learned", content: "deploy uses make ship" });
    hang = true;
    process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS = "150";
    try {
      process.env.BRAIN_DEFER_EMBED = "0";
      await expect(b.remember({ id: "m-x", tier: "episodic", content: "likes espresso" })).rejects.toThrow(/timed out/);
      delete process.env.BRAIN_DEFER_EMBED;
      await b.remember({ id: "m-y", tier: "episodic", content: "prefers tea" }); // deferred
      expect(await b.backfillEmbeddings()).toBe(0); // embedder still down → abort, no spin
    } finally {
      delete process.env.BRAIN_DEFER_EMBED;
      delete process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS;
      b.close();
    }
  });
});

describe("Brain — GPU-aware backfill gate (Tur-4: LLM-active defers embedding)", () => {
  test("gpu-coordinator: active while a generation runs and within the quiet window", async () => {
    const { beginLLM, endLLM, llmActive, resetGpuCoordinatorForTest } = await import("./gpu-coordinator");
    resetGpuCoordinatorForTest();
    expect(llmActive(1_000_000)).toBe(false);
    beginLLM(1_000_000);
    expect(llmActive(1_000_500)).toBe(true); // mid-generation
    endLLM(1_001_000);
    expect(llmActive(1_002_000)).toBe(true); // quiet window (default 2s) still hot
    expect(llmActive(1_004_000)).toBe(false); // quiet window elapsed
    resetGpuCoordinatorForTest();
  });

  test("backfill defers while the LLM is active, drains when idle, forces past the boundary", async () => {
    let hang = false;
    const embed = async (t: string) => (hang ? new Promise<number[]>(() => {}) : VECTORS[t] ?? [0, 0, 1]);
    let active = true;
    const b = createBrainStore({ dbPath: tmpDb(), embed, llmActive: () => active });
    await b.remember({ id: "m-base", tier: "learned", content: "deploy uses make ship" });
    hang = true;
    process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS = "120";
    try {
      for (let i = 0; i < 4; i++) await b.remember({ id: `m-p${i}`, tier: "episodic", content: `pending note ${i}` });
      hang = false;
      expect(await b.backfillEmbeddings()).toBe(0); // GPU busy → defer entirely
      process.env.BRAIN_BACKFILL_BOUNDARY = "3"; // 4 pending > boundary → starvation guard
      expect(await b.backfillEmbeddings({ limit: 2 })).toBe(2); // forced single small batch
      delete process.env.BRAIN_BACKFILL_BOUNDARY;
      expect(await b.backfillEmbeddings()).toBe(0); // back under boundary, still busy → defer
      active = false;
      expect(await b.backfillEmbeddings()).toBe(2); // idle → drain the rest
    } finally {
      delete process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS;
      delete process.env.BRAIN_BACKFILL_BOUNDARY;
      b.close();
    }
  });
});

describe("Brain — belief revision (Tur-5: negation supersedes contradicted memories)", () => {
  test("contradictionSignal + entityOverlap primitives", async () => {
    const { contradictionSignal, entityOverlap } = await import("./brain");
    expect(contradictionSignal("I am strictly vegan now, no pizza anymore")).toBe(true);
    expect(contradictionSignal("artık kahve içmiyorum, bıraktım")).toBe(true);
    expect(contradictionSignal("user loves eating pepperoni pizza")).toBe(false);
    expect(entityOverlap("loves pepperoni pizza", "no pizza anymore")).toBeGreaterThanOrEqual(1);
    expect(entityOverlap("deploy make ship", "no pizza anymore")).toBe(0);
  });

  test("a negation write supersedes the near contradicted memory; recall stops returning it", async () => {
    const V: Record<string, number[]> = {
      "user loves eating pepperoni pizza": [1, 0, 0],
      "user is strictly vegan now, no pizza anymore": [0.9, 0.1, 0],
    };
    const b = createBrainStore({ dbPath: tmpDb(), embed: async (t) => V[t] ?? [0, 0, 1] });
    const old = await b.remember({ tier: "learned", content: "user loves eating pepperoni pizza" });
    process.env.BRAIN_REVISION_DISTANCE = "2"; // fake-embed space → wide gate; entity overlap does the narrowing
    try {
      const neu = await b.remember({ tier: "learned", content: "user is strictly vegan now, no pizza anymore" });
      expect((neu as any).revised).toContain(old.id);
      const hits = await b.recall("user loves eating pepperoni pizza", { k: 5 });
      expect(hits.map((h) => h.id)).not.toContain(old.id); // superseded → gone from recall
      expect(hits.map((h) => h.id)).toContain(neu.id);
    } finally {
      delete process.env.BRAIN_REVISION_DISTANCE;
      b.close();
    }
  });

  test("core is never revised; BRAIN_REVISION=0 disables; no-negation writes revise nothing", async () => {
    const V: Record<string, number[]> = {
      "core identity: Emre speaks Turkish": [1, 0, 0],
      "not Turkish anymore whatever": [0.9, 0.1, 0],
      "user likes green tea": [0, 1, 0],
      "user likes black tea too": [0.1, 0.9, 0],
    };
    const b = createBrainStore({ dbPath: tmpDb(), embed: async (t) => V[t] ?? [0, 0, 1] });
    process.env.BRAIN_REVISION_DISTANCE = "2";
    try {
      const core = await b.remember({ id: "c-1", tier: "core", content: "core identity: Emre speaks Turkish" });
      const attack = await b.remember({ tier: "working", content: "not Turkish anymore whatever" });
      expect((attack as any).revised ?? []).not.toContain(core.id); // core untouchable
      const t1 = await b.remember({ tier: "learned", content: "user likes green tea" });
      const t2 = await b.remember({ tier: "learned", content: "user likes black tea too" });
      expect((t2 as any).revised ?? []).toHaveLength(0); // no negation signal → no revision
      process.env.BRAIN_REVISION = "0";
      const off = await b.remember({ tier: "learned", content: "no green tea anymore" });
      expect((off as any).revised ?? []).toHaveLength(0); // disabled
      expect((await b.recall("user likes green tea", { k: 5 })).map((h) => h.id)).toContain(t1.id);
    } finally {
      delete process.env.BRAIN_REVISION;
      delete process.env.BRAIN_REVISION_DISTANCE;
      b.close();
    }
  });
});

describe("Brain — shadow evaluation (Tur-6: counterfactual recall telemetry)", () => {
  test("rbo: identical ranking → 1, disjoint → 0, partial overlap in between", async () => {
    const { rbo } = await import("./brain-shadow");
    expect(rbo(["a", "b", "c"], ["a", "b", "c"])).toBeCloseTo(1, 5);
    expect(rbo(["a", "b"], ["x", "y"])).toBe(0);
    const partial = rbo(["a", "b", "c"], ["a", "x", "y"]);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    expect(rbo([], [])).toBe(1); // two empty rankings agree vacuously
  });

  test("maybeShadowEval: samples, skips under GPU load, logs rbo of the counterfactual arm", async () => {
    const { maybeShadowEval } = await import("./brain-shadow");
    const live = [{ id: "a" }, { id: "b" }];
    const alt = [{ id: "b" }, { id: "a" }];
    const calls: any[] = [];
    const events: any[] = [];
    const shadowRecall = async (_q: string, opts: any) => { calls.push(opts); return alt as any; };
    // GPU busy → never runs, regardless of sampling
    await maybeShadowEval("q", live as any, shadowRecall, { rate: 1, rng: () => 0, llmActive: () => true, emit: (e) => events.push(e) });
    expect(calls).toHaveLength(0);
    // idle + sampled → runs the counterfactual arm and emits rbo
    await maybeShadowEval("q", live as any, shadowRecall, { rate: 1, rng: () => 0, llmActive: () => false, emit: (e) => events.push(e) });
    expect(calls).toHaveLength(1);
    expect(calls[0].graphExpand).toBe(true); // counterfactual flips the graph arm
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("brain.shadow");
    expect(events[0].rbo).toBeGreaterThan(0);
    expect(events[0].rbo).toBeLessThan(1);
    // not sampled → skipped silently
    await maybeShadowEval("q", live as any, shadowRecall, { rate: 0.01, rng: () => 0.9, llmActive: () => false, emit: (e) => events.push(e) });
    expect(calls).toHaveLength(1);
  });
});

describe("Brain — 2026 gap B1: abstention (grounding threshold)", () => {
  test("recall drops hits below minScore; env gate; abstains to [] instead of guessing", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m-close", tier: "learned", content: "likes espresso" });
    await b.remember({ id: "m-far", tier: "learned", content: "deploy uses make ship" });
    const all = await b.recall("query_coffee", { k: 5 });
    expect(all.map((h) => h.id)).toContain("m-far"); // no threshold → distant noise included
    const близко = all.find((h) => h.id === "m-close")!.score;
    const uzak = all.find((h) => h.id === "m-far")!.score;
    const gated = await b.recall("query_coffee", { k: 5, minScore: (близко + uzak) / 2 });
    expect(gated.map((h) => h.id)).toEqual(["m-close"]); // distant hit abstained away
    process.env.BRAIN_RECALL_MIN_SCORE = String(близко + 1);
    try {
      expect(await b.recall("query_coffee", { k: 5 })).toEqual([]); // nothing grounded → say nothing
    } finally {
      delete process.env.BRAIN_RECALL_MIN_SCORE;
      b.close();
    }
  });
});

describe("Brain — 2026 gaps B3+B4: audit ledger + right-to-be-forgotten", () => {
  test("every write/merge/revise/forget lands in the append-only audit ledger", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m-1", tier: "learned", content: "likes espresso" });
    const gone = await b.forget({ contains: "espresso" });
    expect(gone.forgotten).toBe(1);
    const tail = b.auditTail(10);
    expect(tail.map((a) => a.action)).toEqual(expect.arrayContaining(["remember", "forget"]));
    expect(tail.find((a) => a.action === "forget")?.detail).toContain("espresso");
    b.close();
  });

  test("forget removes row+vector+fts (subject purge), ns-scoped, and recall no longer finds it", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m-a", tier: "learned", content: "likes espresso" });
    await b.remember({ id: "m-b", tier: "learned", content: "prefers tea" });
    await b.remember({ id: "m-c", tier: "learned", content: "likes espresso", ns: "tenant-b" });
    const r = await b.forget({ contains: "espresso" }); // default ns only
    expect(r.forgotten).toBe(1);
    expect((await b.recall("query_coffee", { k: 5 })).map((h) => h.id)).not.toContain("m-a");
    expect((await b.recall("query_coffee", { k: 5, ns: "tenant-b" })).map((h) => h.id)).toContain("m-c");
    expect(b.stats().memories.learned).toBe(2); // m-b + tenant-b's m-c
    b.close();
  });
});
