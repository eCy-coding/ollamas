// Brain v1 (Tur 4) — tiered semantic memory + bi-temporal facts on the rag.ts
// sqlite-vec pattern (agentmem tier blueprint + graphiti valid_from/invalidated_at
// edges). Deterministic via a FAKE embedder; live ollama path is RUN_LIVE_E2E-gated.
// Flows through the ToolRegistry choke-point like rag_index/rag_search.
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { createBrainStore, parseExtraction, TIER_WEIGHT } from "../server/brain";

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

  test("createdAt override keeps original event time for imports", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    const then = Date.parse("2026-01-01T00:00:00Z");
    await b.remember({ id: "m-old", tier: "episodic", content: "likes espresso", createdAt: then });
    await b.remember({ id: "m-new", tier: "episodic", content: "prefers tea" });
    const rows = (await b.overview({ recent: 5 })).memories;
    expect(rows.find((m) => m.id === "m-old")?.createdAt).toBe(then);
    // a migrated 6-month-old episodic memory must NOT score as fresh
    expect(rows.find((m) => m.id === "m-new")!.createdAt).toBeGreaterThan(then);
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

describe("Brain — tenant namespace isolation (H1, security)", () => {
  const ctxFor = (tenantId?: string) =>
    ({ isLive: false, workspaceRoot: ".", autoApply: true, deps: {} as any, tenantId }) as any;
  // Fresh process-wide store per test: the singleton caches its first BRAIN_DB_PATH,
  // and BRAIN_EMBED_FAKE keeps the choke-point deterministic (no live ollama).
  const freshRegistry = async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.BRAIN_EMBED_FAKE = "1";
    process.env.BRAIN_DB_PATH = tmpDb();
    return (await import("../server/tool-registry")).ToolRegistry;
  };

  test("tenant writes land in tenant:<id> ns and args.ns is IGNORED under a tenant ctx", async () => {
    const ToolRegistry = await freshRegistry();
    // Host owner seeds the default namespace.
    await ToolRegistry.execute("brain_remember", { tier: "core", content: "host secret" }, ctxFor(undefined));
    // Tenant A writes — trying to smuggle ns:"default".
    const w = await ToolRegistry.execute(
      "brain_remember",
      { tier: "core", content: "tenant-a note", ns: "default" },
      ctxFor("acme"),
    );
    expect(w.ok).toBe(true);
    // Tenant A recall must see ONLY its own namespace, even when asking for ns:"default".
    const ra = await ToolRegistry.execute("brain_recall", { query: "anything", ns: "default" }, ctxFor("acme"));
    expect(ra.ok).toBe(true);
    const contentsA = ra.output.results.map((r: { content: string }) => r.content);
    expect(contentsA).toContain("tenant-a note");
    expect(contentsA).not.toContain("host secret");
    // Tenant B sees neither host nor tenant A data.
    const rb = await ToolRegistry.execute("brain_recall", { query: "anything" }, ctxFor("globex"));
    expect(rb.output.results).toEqual([]);
    // Host owner (no tenant) still sees the default namespace only.
    const rh = await ToolRegistry.execute("brain_recall", { query: "anything" }, ctxFor(undefined));
    const contentsH = rh.output.results.map((r: { content: string }) => r.content);
    expect(contentsH).toContain("host secret");
    expect(contentsH).not.toContain("tenant-a note");
    delete process.env.BRAIN_DB_PATH;
    delete process.env.BRAIN_EMBED_FAKE;
  });

  test("tenant facts are namespace-jailed too (assert + facts + semantic)", async () => {
    const ToolRegistry = await freshRegistry();
    await ToolRegistry.execute(
      "brain_fact_assert",
      { subject: "emre", predicate: "plan", object: "secret-roadmap" },
      ctxFor(undefined),
    );
    const t = await ToolRegistry.execute("brain_facts", { subject: "emre" }, ctxFor("acme"));
    expect(t.output.facts).toEqual([]); // tenant cannot list host facts
    const ts = await ToolRegistry.execute("brain_facts", { query: "roadmap plan" }, ctxFor("acme"));
    expect(ts.output.facts).toEqual([]); // nor find them semantically
    delete process.env.BRAIN_DB_PATH;
    delete process.env.BRAIN_EMBED_FAKE;
  });
});

describe("Brain — auto-recall context block (H3, server/brain-context.ts)", () => {
  test("builds a memory block from recall + facts, capped", async () => {
    const { buildBrainContext } = await import("../server/brain-context");
    const block = await buildBrainContext("deploy nasıl?", {
      recall: async () => [
        { id: "a", tier: "procedural", content: "deploy = make ship (gate önce)", score: 0.9, distance: 0.1, createdAt: 1 },
        { id: "b", tier: "learned", content: "gate kırmızı → commit bloklanır", score: 0.5, distance: 0.4, createdAt: 1 },
      ],
      searchFacts: async () => [
        { subject: "ollamas", predicate: "deploy_cmd", object: "make ship", validFrom: 1, invalidatedAt: null, distance: 0.2 },
      ],
    } as any);
    expect(block).toContain("## Hafızadan (brain)");
    expect(block).toContain("make ship");
    expect(block).toContain("ollamas deploy_cmd make ship");
    expect(block.length).toBeLessThanOrEqual(1200);
  });

  test("empty brain → empty string (zero prompt pollution)", async () => {
    const { buildBrainContext } = await import("../server/brain-context");
    const block = await buildBrainContext("q", { recall: async () => [], searchFacts: async () => [] } as any);
    expect(block).toBe("");
  });

  test("provider failure → empty string, never throws (best-effort)", async () => {
    const { buildBrainContext } = await import("../server/brain-context");
    const block = await buildBrainContext("q", {
      recall: async () => { throw new Error("ollama down"); },
      searchFacts: async () => { throw new Error("ollama down"); },
    } as any);
    expect(block).toBe("");
  });
});

describe("Brain — MCP expose gate (H2)", () => {
  test("brainMcpFilter hides brain_* unless BRAIN_MCP_EXPOSE=1", async () => {
    const { brainMcpAllowed } = await import("../server/mcp/server");
    expect(brainMcpAllowed("brain_recall", {})).toBe(false);
    expect(brainMcpAllowed("brain_remember", {})).toBe(false);
    expect(brainMcpAllowed("rag_search", {})).toBe(true); // non-brain untouched
    expect(brainMcpAllowed("brain_recall", { BRAIN_MCP_EXPOSE: "1" })).toBe(true);
  });
});

describe("Brain — choke-point wiring", () => {
  test("tool tiers: writes host, reads safe", async () => {
    const { ToolRegistry } = await import("../server/tool-registry");
    expect(ToolRegistry.tier("brain_remember")).toBe("host");
    expect(ToolRegistry.tier("brain_ingest")).toBe("host");
    expect(ToolRegistry.tier("brain_fact_assert")).toBe("host");
    expect(ToolRegistry.tier("brain_sweep")).toBe("host");
    expect(ToolRegistry.tier("brain_recall")).toBe("safe");
    expect(ToolRegistry.tier("brain_facts")).toBe("safe");
    expect(ToolRegistry.tier("brain_health")).toBe("safe");
  });

  test("brain_recall on an empty store returns [] without an embedder call", async () => {
    process.env.BRAIN_DB_PATH = tmpDb();
    const { ToolRegistry } = await import("../server/tool-registry");
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

describe("Brain v2 — semantic fact search (fact embeddings)", () => {
  const factVectors: Record<string, number[]> = {
    "emre prefers_editor helix": [1, 0, 0],
    "emre prefers_editor vim": [0.95, 0.05, 0],
    "ollamas listens_on 3000": [0, 1, 0],
    query_editor: [1, 0, 0],
  };
  const factEmbed = async (t: string) => factVectors[t] ?? [0, 0, 1];

  test("searchFacts finds semantically-near facts and respects validity", async () => {
    let t = 1000;
    const b = createBrainStore({ dbPath: tmpDb(), embed: factEmbed, now: () => t });
    await b.assertFact({ subject: "emre", predicate: "prefers_editor", object: "vim" });
    t = 2000;
    await b.assertFact({ subject: "emre", predicate: "prefers_editor", object: "helix" }); // supersedes vim
    await b.assertFact({ subject: "ollamas", predicate: "listens_on", object: "3000" });

    // KNN contract (same as rag.search): k nearest VALID facts, nearest first, no
    // distance cutoff. vim is invalidated at t=2000 so it must not appear "now".
    const nowHits = await b.searchFacts("query_editor", { k: 3 });
    expect(nowHits[0].object).toBe("helix");
    expect(nowHits.map((f) => f.object)).not.toContain("vim");

    const thenHits = await b.searchFacts("query_editor", { k: 3, at: 1500 });
    expect(thenHits[0].object).toBe("vim");
    expect(thenHits.map((f) => f.object)).not.toContain("helix"); // not yet asserted at t=1500
    b.close();
  });

  test("searchFacts on an empty store returns []", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: factEmbed });
    expect(await b.searchFacts("anything", { k: 3 })).toEqual([]);
    b.close();
  });
});

describe("Brain v2 — sweep + consolidation (access-based)", () => {
  test("sweep deletes expired working memories only", async () => {
    let t = 1;
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, now: () => t });
    await b.remember({ id: "w-old", tier: "working", content: "likes espresso" });
    await b.remember({ id: "c-old", tier: "core", content: "prefers tea" });
    t = 8 * 86_400_000; // 8 days later (default working TTL = 7d)
    await b.remember({ id: "w-new", tier: "working", content: "deploy uses make ship" });
    const out = b.sweep();
    expect(out.swept).toBe(1); // only w-old
    const hits = await b.recall("query_coffee", { k: 5 });
    expect(hits.map((h) => h.id)).not.toContain("w-old");
    expect(hits.map((h) => h.id)).toContain("c-old");
    b.close();
  });

  test("recall bumps access_count; consolidate promotes hot episodic memories to learned", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "ep-hot", tier: "episodic", content: "likes espresso" });
    await b.remember({ id: "ep-cold", tier: "episodic", content: "deploy uses make ship" });
    // Recall the hot memory 3 times (default promotion threshold).
    await b.recall("query_coffee", { k: 1 });
    await b.recall("query_coffee", { k: 1 });
    await b.recall("query_coffee", { k: 1 });
    const out = b.consolidate();
    expect(out.promoted).toBe(1);
    const hits = await b.recall("query_coffee", { k: 1 });
    expect(hits[0].id).toBe("ep-hot");
    expect(hits[0].tier).toBe("learned");
    b.close();
  });
});

describe("Brain v3 — working ring-buffer cap (E1)", () => {
  test("working tier evicts its OLDEST row beyond the cap; other tiers untouched", async () => {
    let t = 0;
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, now: () => ++t, workingCap: 3 });
    await b.remember({ id: "c1", tier: "core", content: "prefers tea" });
    for (const id of ["w1", "w2", "w3", "w4"]) {
      await b.remember({ id, tier: "working", content: "likes espresso" });
    }
    const hits = await b.recall("query_coffee", { k: 10 });
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain("w1"); // ring: oldest working evicted
    expect(ids).toEqual(expect.arrayContaining(["w2", "w3", "w4", "c1"]));
    expect(b.stats().memories.working).toBe(3);
    expect(b.stats().memories.core).toBe(1);
    b.close();
  });
});

describe("Brain v3 — consolidation dedupe/merge (E2)", () => {
  test("duplicate learned contents merge into the oldest id with summed hits", async () => {
    let t = 0;
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, now: () => ++t });
    await b.remember({ id: "l1", tier: "learned", content: "likes espresso" });
    await b.remember({ id: "l2", tier: "learned", content: "  Likes   ESPRESSO " }); // same after normalize
    await b.remember({ id: "l3", tier: "learned", content: "deploy uses make ship" });
    await b.recall("query_coffee", { k: 2 }); // bump both espresso rows
    const out = b.consolidate();
    expect(out.merged).toBe(1);
    const hits = await b.recall("query_coffee", { k: 5 });
    const espresso = hits.filter((h) => h.id === "l1" || h.id === "l2");
    expect(espresso).toHaveLength(1);
    expect(espresso[0].id).toBe("l1"); // oldest survives
    expect(b.stats().memories.learned).toBe(2); // merged + the unrelated one
    b.close();
  });
});

describe("Brain v3 — health / drift probe (E3)", () => {
  test("stable embedder → selfHitRate 1.0, no drift", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "a", tier: "learned", content: "likes espresso" });
    await b.remember({ id: "b", tier: "core", content: "deploy uses make ship" });
    const h = await b.health();
    expect(h.selfHitRate).toBe(1);
    expect(h.drift).toBe(false);
    expect(h.probes).toBe(2);
    b.close();
  });

  test("unstable embedder (same text, shifting vectors) → drift detected", async () => {
    // Stateful fake: every call returns a DIFFERENT vector for the same text —
    // simulates a silently swapped/decayed embedding model.
    let call = 0;
    const unstable = async (_t: string) => {
      call++;
      return [Math.sin(call), Math.cos(call), call % 2];
    };
    const b = createBrainStore({ dbPath: tmpDb(), embed: unstable });
    for (let i = 0; i < 4; i++) await b.remember({ id: `m${i}`, tier: "learned", content: `lesson number ${i}` });
    const h = await b.health();
    expect(h.selfHitRate).toBeLessThan(0.8);
    expect(h.drift).toBe(true);
    b.close();
  });

  test("empty brain → healthy by definition (no probes)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    const h = await b.health();
    expect(h.probes).toBe(0);
    expect(h.drift).toBe(false);
    b.close();
  });
});

describe("Brain v2 — session distillation (server/brain-distill.ts)", () => {
  test("distillSession: transcript → LLM → parsed extraction → ingest", async () => {
    const { distillSession } = await import("../server/brain-distill");
    const calls: any[] = [];
    const out = await distillSession(
      {
        id: "sess-7",
        messages: [
          { role: "user", content: "Deploy nasıl yapılıyor?" },
          { role: "assistant", content: "make ship gate'ten geçirip release eder." },
        ],
      },
      {
        generate: async (messages) => {
          calls.push(messages);
          return 'Thinking… {"memories":[{"tier":"procedural","content":"deploy = make ship"}],"facts":[{"subject":"ollamas","predicate":"deploy_cmd","object":"make ship"}]}';
        },
        ingest: async (batch) => {
          calls.push(batch);
          return { memories: batch.memories?.length ?? 0, facts: batch.facts?.length ?? 0 };
        },
      },
    );
    expect(out).toEqual({ memories: 1, facts: 1, skipped: false });
    const [genMessages, batch] = calls;
    expect(genMessages[0].role).toBe("system"); // EXTRACTION_PROMPT rides as system
    expect(genMessages[1].content).toContain("Deploy nasıl");
    expect(batch.episodeId).toBe("sess-7");
  });

  test("distillSession skips tiny sessions without calling the LLM", async () => {
    const { distillSession } = await import("../server/brain-distill");
    let llmCalled = false;
    const out = await distillSession(
      { id: "s", messages: [{ role: "user", content: "selam" }] },
      { generate: async () => { llmCalled = true; return "{}"; }, ingest: async () => ({ memories: 0, facts: 0 }) },
    );
    expect(out.skipped).toBe(true);
    expect(llmCalled).toBe(false);
  });

  test("distillSession survives a garbage LLM reply (best-effort, no throw)", async () => {
    const { distillSession } = await import("../server/brain-distill");
    const out = await distillSession(
      {
        id: "s2",
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
        ],
      },
      { generate: async () => "no json here at all", ingest: async () => ({ memories: 0, facts: 0 }) },
    );
    expect(out).toEqual({ memories: 0, facts: 0, skipped: false });
  });
});

// TIER_WEIGHT is part of the public contract — recall maths depend on the order.
describe("Brain — overview payload (T2, feeds /api/brain/overview + panel)", () => {
  test("overview bundles stats, recent memories, live facts, history, health", async () => {
    let t = 1000;
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, now: () => (t += 1000) });
    await b.remember({ id: "m1", tier: "core", content: "likes espresso" });
    await b.remember({ id: "m2", tier: "working", content: "deploy uses make ship" });
    await b.assertFact({ subject: "emre", predicate: "editor", object: "vim" });
    await b.assertFact({ subject: "emre", predicate: "editor", object: "helix" }); // supersedes vim
    const o = await b.overview({ recent: 10 });
    expect(o.stats.memories.core).toBe(1);
    expect(o.stats.memories.working).toBe(1);
    expect(o.memories.map((m) => m.id)).toContain("m1");
    expect(o.memories[0]).toHaveProperty("hits"); // access_count surfaced
    expect(o.facts.map((f) => f.object)).toEqual(["helix"]); // only live
    expect(o.history.map((h) => h.object)).toContain("vim"); // superseded shows in history
    expect(o.health).toHaveProperty("selfHitRate");
    b.close();
  });

  test("overview on an empty brain is well-formed (no throw)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    const o = await b.overview();
    expect(o.memories).toEqual([]);
    expect(o.facts).toEqual([]);
    expect(o.stats.facts).toBe(0);
    expect(o.health.drift).toBe(false);
    b.close();
  });
});

describe("Brain — concurrency (T1: WAL + busy_timeout)", () => {
  test("a reader store does not lock out a writer on the same db file", async () => {
    const path = tmpDb();
    const writer = createBrainStore({ dbPath: path, embed: fakeEmbed });
    const reader = createBrainStore({ dbPath: path, embed: fakeEmbed });
    // Interleave: reader polls while the writer commits 20 rows. Pre-WAL this throws
    // "database is locked"; with WAL + busy_timeout it must all succeed.
    for (let i = 0; i < 20; i++) {
      await writer.remember({ id: `w${i}`, tier: "working", content: "likes espresso" });
      await reader.recall("query_coffee", { k: 3 }); // concurrent reader
    }
    expect(writer.stats().memories.working).toBeGreaterThan(0);
    const hits = await reader.recall("query_coffee", { k: 30 });
    expect(hits.length).toBeGreaterThan(0);
    writer.close();
    reader.close();
  });

  test("brain db runs in WAL journal mode", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const path = tmpDb();
    const b = createBrainStore({ dbPath: path, embed: fakeEmbed });
    await b.remember({ id: "x", tier: "core", content: "prefers tea" });
    const probe = new DatabaseSync(path);
    const mode = (probe.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
    expect(mode.toLowerCase()).toBe("wal");
    probe.close();
    b.close();
  });
});

describe("Brain v4 — RRF fusion (W1, pure)", () => {
  test("rrfFuse rewards items ranked by BOTH retrievers", async () => {
    const { rrfFuse } = await import("../server/brain");
    // vec ranks: [a,b,c]; fts ranks: [c,a,d]. c and a appear in both → rise.
    const fused = rrfFuse(["a", "b", "c"], ["c", "a", "d"], 4);
    expect(fused[0]).toBe("a"); // rank1 vec + rank2 fts → highest RRF
    expect(fused).toContain("c");
    expect(fused.slice(0, 2)).toEqual(expect.arrayContaining(["a", "c"]));
  });

  test("rrfFuse handles one empty list (vector-only fallback)", async () => {
    const { rrfFuse } = await import("../server/brain");
    expect(rrfFuse(["a", "b"], [], 5)).toEqual(["a", "b"]);
    expect(rrfFuse([], ["x", "y"], 5)).toEqual(["x", "y"]);
  });
});

describe("Brain v4 — hybrid retrieval (W1, FTS5 + vector)", () => {
  test("keyword-only match the embedder misses is surfaced by hybrid recall", async () => {
    // fakeEmbed maps unknown text to [0,0,1]; a rare token query won't be near any doc
    // vector, but FTS5 BM25 matches the literal token.
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "d1", tier: "learned", content: "the ZQXVK deploy token lives in vault" });
    await b.remember({ id: "d2", tier: "learned", content: "likes espresso" });
    await b.remember({ id: "d3", tier: "learned", content: "prefers tea" });
    const hits = await b.recall("ZQXVK", { k: 3 });
    expect(hits.map((h) => h.id)).toContain("d1"); // found via keyword, not vector
    b.close();
  });

  test("existing vector recall still works (no FTS regression)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "m1", tier: "core", content: "likes espresso" });
    const hits = await b.recall("query_coffee", { k: 3 });
    expect(hits.map((h) => h.id)).toContain("m1");
    b.close();
  });
});

describe("Brain v4 — semantic write-dedup (W2, AUDN-lite)", () => {
  test("a near-duplicate memory MERGES instead of polluting recall", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    // Same vector (identical content maps to same fake vector) → near-duplicate.
    await b.remember({ tier: "learned", content: "likes espresso" });
    const second = await b.remember({ tier: "learned", content: "likes espresso" });
    expect(second.merged).toBe(true);
    expect(b.stats().memories.learned).toBe(1); // no duplicate row
    b.close();
  });

  test("distinct content inserts a new row", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ tier: "learned", content: "likes espresso" });
    const second = await b.remember({ tier: "learned", content: "deploy uses make ship" });
    expect(second.merged).toBeFalsy();
    expect(b.stats().memories.learned).toBe(2);
    b.close();
  });

  test("core tier is never auto-merged (identity safety)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ tier: "core", content: "likes espresso" });
    const second = await b.remember({ tier: "core", content: "likes espresso" });
    expect(second.merged).toBeFalsy();
    expect(b.stats().memories.core).toBe(2);
    b.close();
  });

  test("explicit id keeps exact-upsert semantics (no dedup surprise)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.remember({ id: "fixed", tier: "learned", content: "likes espresso" });
    const second = await b.remember({ id: "fixed", tier: "learned", content: "prefers tea" });
    expect(second.merged).toBeFalsy();
    expect(second.id).toBe("fixed");
    expect(b.stats().memories.learned).toBe(1);
    b.close();
  });
});

describe("Brain v5 — entity graph reification (V1, pure)", () => {
  test("buildGraph turns S-P-O facts into nodes + edges with degree", async () => {
    const { buildGraph } = await import("../server/brain");
    const g = buildGraph([
      { subject: "emre", predicate: "uses", object: "ollamas", validFrom: 1, invalidatedAt: null },
      { subject: "emre", predicate: "prefers", object: "cerebras", validFrom: 2, invalidatedAt: null },
      { subject: "ollamas", predicate: "runs_on", object: "macbook", validFrom: 3, invalidatedAt: null },
    ] as any);
    // 5 distinct entities: emre, ollamas, cerebras, macbook (+ none dup)
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["cerebras", "emre", "macbook", "ollamas"]);
    expect(g.edges).toHaveLength(3);
    const emre = g.nodes.find((n) => n.id === "emre")!;
    expect(emre.degree).toBe(2); // uses + prefers
    const ollamas = g.nodes.find((n) => n.id === "ollamas")!;
    expect(ollamas.degree).toBe(2); // object of 'uses' + subject of 'runs_on'
    expect(emre.live).toBe(true);
  });

  test("superseded facts render as non-live edges; nodes flagged live if any live edge", async () => {
    const { buildGraph } = await import("../server/brain");
    const g = buildGraph([
      { subject: "emre", predicate: "editor", object: "vim", validFrom: 1, invalidatedAt: 100 },
      { subject: "emre", predicate: "editor", object: "helix", validFrom: 100, invalidatedAt: null },
    ] as any);
    const vimEdge = g.edges.find((e) => e.target === "vim")!;
    const helixEdge = g.edges.find((e) => e.target === "helix")!;
    expect(vimEdge.live).toBe(false);
    expect(helixEdge.live).toBe(true);
    expect(g.nodes.find((n) => n.id === "vim")!.live).toBe(false); // only a dead edge
    expect(g.nodes.find((n) => n.id === "emre")!.live).toBe(true); // has a live edge
  });

  test("empty facts → empty graph, no throw", async () => {
    const { buildGraph } = await import("../server/brain");
    expect(buildGraph([])).toEqual({ nodes: [], edges: [] });
  });

  test("label keeps original case; id is normalized (Emre==emre one node)", async () => {
    const { buildGraph } = await import("../server/brain");
    const g = buildGraph([
      { subject: "Emre", predicate: "is", object: "T0", validFrom: 1, invalidatedAt: null },
      { subject: "emre", predicate: "runs", object: "ollamas", validFrom: 2, invalidatedAt: null },
    ] as any);
    const emre = g.nodes.filter((n) => n.id === "emre");
    expect(emre).toHaveLength(1); // merged by normalized id
    expect(emre[0].degree).toBe(2);
  });
});

describe("Brain v5 — graph() store method + endpoint shape", () => {
  test("graph() returns live entity graph for the namespace", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await b.assertFact({ subject: "emre", predicate: "uses", object: "ollamas" });
    await b.assertFact({ subject: "ollamas", predicate: "port", object: "3000" });
    const g = await b.graph();
    expect(g.nodes.length).toBe(3); // emre, ollamas, 3000
    expect(g.edges.length).toBe(2);
    expect(g.nodes.find((n) => n.id === "ollamas")!.degree).toBe(2);
    b.close();
  });

  test("graph() on empty brain is well-formed", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed });
    const g = await b.graph();
    expect(g).toEqual({ nodes: [], edges: [] });
    b.close();
  });
});

describe("Brain v6 — always-on helpers (Y1, pure)", () => {
  test("buildTurnMemory folds last user+assistant into a working memory", async () => {
    const { buildTurnMemory } = await import("../server/brain-active");
    const m = buildTurnMemory(
      [
        { role: "user", content: "deploy nasıl?" },
        { role: "assistant", content: "make ship" },
      ],
      "sess-1",
    );
    expect(m?.tier).toBe("working");
    expect(m?.content).toContain("deploy nasıl?");
    expect(m?.content).toContain("make ship");
    expect(m?.source).toBe("turn:sess-1");
  });

  test("buildTurnMemory returns null when there is nothing to remember", async () => {
    const { buildTurnMemory } = await import("../server/brain-active");
    expect(buildTurnMemory([{ role: "system", content: "x" }])).toBeNull();
    expect(buildTurnMemory([])).toBeNull();
  });

  test("resolveDistillProvider defaults to keyless pollinations ($0), pin wins", async () => {
    const { resolveDistillProvider } = await import("../server/brain-active");
    expect(resolveDistillProvider({})).toBe("pollinations"); // never spends session provider
    expect(resolveDistillProvider({ BRAIN_DISTILL_PROVIDER: "groq" })).toBe("groq");
  });

  test("activeOn: on unless explicitly '0' (opt-out default-ON semantics)", async () => {
    const { activeOn } = await import("../server/brain-active");
    expect(activeOn(undefined)).toBe(true); // default ON
    expect(activeOn("1")).toBe(true);
    expect(activeOn("0")).toBe(false); // opt-out
  });
});

describe("Brain — tier weights", () => {
  test("core > learned > procedural > episodic > working", () => {
    expect(TIER_WEIGHT.core).toBeGreaterThan(TIER_WEIGHT.learned);
    expect(TIER_WEIGHT.learned).toBeGreaterThan(TIER_WEIGHT.procedural);
    expect(TIER_WEIGHT.procedural).toBeGreaterThan(TIER_WEIGHT.episodic);
    expect(TIER_WEIGHT.episodic).toBeGreaterThan(TIER_WEIGHT.working);
  });
});

describe("Brain P3 — usage reinforcement (bounded)", () => {
  test("often-recalled memory outranks a cold twin at equal distance+tier", async () => {
    const t = 1_000_000;
    const twin = async (s: string) => (s.startsWith("alpha") ? [1, 0, 0] : [0, 0, 1]);
    const b = createBrainStore({ dbPath: tmpDb(), embed: twin, now: () => t });
    await b.remember({ id: "mA", tier: "learned", content: "alpha one" });
    await b.remember({ id: "mB", tier: "learned", content: "alpha two" });
    const hot = (await b.recall("alpha probe", { k: 1 }))[0].id; // 3 bumps on whichever wins the tie
    await b.recall("alpha probe", { k: 1 });
    await b.recall("alpha probe", { k: 1 });
    const hits = await b.recall("alpha probe", { k: 2 });
    expect(hits[0].id).toBe(hot);
    expect(hits[0].score).toBeGreaterThan(hits[1].score); // strictly, not a tie
    b.close();
  });

  test("CONTRACT: no amount of heat lets working outrank core at equal distance", async () => {
    const t = 1_000_000;
    const twin = async (s: string) => (s.startsWith("beta") ? [1, 0, 0] : [0, 0, 1]);
    const b = createBrainStore({ dbPath: tmpDb(), embed: twin, now: () => t });
    await b.remember({ id: "w", tier: "working", content: "beta work" });
    await b.remember({ id: "c", tier: "core", content: "beta core" });
    for (let i = 0; i < 10; i++) await b.recall("beta probe", { k: 1, tier: "working" }); // heat only w
    const hits = await b.recall("beta probe", { k: 2 });
    expect(hits[0].id).toBe("c"); // tier weight still dominates
    b.close();
  });

  test("usageBoost is monotonic and capped below the core/learned tier ratio", async () => {
    const { usageBoost, TIER_WEIGHT: W } = await import("../server/brain");
    expect(usageBoost(0)).toBe(1);
    expect(usageBoost(5)).toBeGreaterThan(usageBoost(1));
    expect(usageBoost(1_000_000)).toBeLessThan(W.core / W.learned); // 1.12 < 1.13
  });
});

describe("Brain P3 — tier-specific recency half-life", () => {
  test("core never decays; working/episodic/learned halve at 1/7/90 days", async () => {
    const { tierRecency } = await import("../server/brain");
    const day = 86_400_000;
    const now = 400 * day;
    expect(tierRecency(now - 365 * day, now, "core")).toBe(1);
    expect(tierRecency(now - 1 * day, now, "working")).toBeCloseTo(0.5, 5);
    expect(tierRecency(now - 7 * day, now, "episodic")).toBeCloseTo(0.5, 5);
    expect(tierRecency(now - 90 * day, now, "learned")).toBeCloseTo(0.5, 5);
    expect(tierRecency(now, now, "working")).toBe(1); // fresh = no decay anywhere
  });
});

describe("Brain P4 — importance-prune (episodic/working only)", () => {
  test("cold old episodic falls off; hot same-age twin survives; core/learned immune", async () => {
    const day = 86_400_000;
    let t = 0;
    const twin = async (s: string) => (s.startsWith("cold") ? [1, 0, 0] : s.startsWith("hot") ? [0, 1, 0] : [0, 0, 1]);
    const b = createBrainStore({ dbPath: tmpDb(), embed: twin, now: () => t });
    await b.remember({ id: "ep-cold", tier: "episodic", content: "cold event" });
    await b.remember({ id: "ep-hot", tier: "episodic", content: "hot event" });
    await b.remember({ id: "core-old", tier: "core", content: "identity never dies" });
    await b.remember({ id: "l-old", tier: "learned", content: "lesson never auto-dies" });
    for (let i = 0; i < 10; i++) await b.recall("hot event", { k: 1, tier: "episodic" }); // heat ep-hot only
    t = 43 * day; // recency(episodic,43d)=7/50=0.14 → cold importance 0.14 < 0.15 ≤ hot 0.14×1.0847
    const out = b.sweep({ pruneThreshold: 0.15 });
    expect(out.pruned).toBe(1);
    const s = b.stats().memories;
    expect(s.episodic).toBe(1); // ep-hot survived
    expect(s.core).toBe(1);
    expect(s.learned).toBe(1);
    b.close();
  });

  test("BRAIN_PRUNE=0 opts out", async () => {
    process.env.BRAIN_PRUNE = "0";
    try {
      let t = 0;
      const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, now: () => t });
      await b.remember({ id: "ep", tier: "episodic", content: "likes espresso" });
      t = 365 * 86_400_000;
      const out = b.sweep({ pruneThreshold: 0.99 });
      expect(out.pruned).toBe(0);
      expect(b.stats().memories.episodic).toBe(1);
      b.close();
    } finally {
      delete process.env.BRAIN_PRUNE;
    }
  });
});

describe("Brain P3 — graph-expansion recall (1-hop over facts)", () => {
  // Query vector can't reach the target (41 memories, KNN overfetch caps at 36) and its
  // keywords don't match — only the fact edge "emre deploys ollamas" names the entity
  // "ollamas", whose mention pulls the target in as a third RRF arm.
  const graphEmbed = async (s: string): Promise<number[]> => {
    if (s === "who deploys" || s === "emre deploys ollamas") return [0, 1, 0];
    if (s === "ollamas boots with launchd") return [1, 0, 0];
    const m = s.match(/^filler (\d+)$/);
    if (m) return [0.001 * Number(m[1]), 1, 0];
    return [0, 0, 1];
  };

  test("graphExpand surfaces an entity-linked memory the query itself cannot reach", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: graphEmbed });
    for (let i = 0; i < 40; i++) await b.remember({ id: `f${i}`, tier: "episodic", content: `filler ${i}` });
    await b.remember({ id: "m-target", tier: "core", content: "ollamas boots with launchd" });
    await b.assertFact({ subject: "emre", predicate: "deploys", object: "ollamas" });
    const plain = await b.recall("who deploys", { k: 5, tier: "core" });
    expect(plain).toEqual([]); // outside vector overfetch, no keyword overlap
    const expanded = await b.recall("who deploys", { k: 5, tier: "core", graphExpand: true });
    expect(expanded.map((h) => h.id)).toEqual(["m-target"]);
    b.close();
  });
});
