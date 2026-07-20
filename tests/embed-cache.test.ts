// Embed-cache (P1) — memoizes Embedder calls: in-mem LRU + persistent embed_cache
// table. Contract: a cache HIT must not call the underlying embedder; vectors are
// Float32-roundtripped (same precision brain_vec already stores). Deterministic,
// no ollama needed.
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEmbedCache } from "../server/embed-cache";
import { createBrainStore } from "../server/brain";

const tmpDb = () => path.join(os.tmpdir(), `ollamas-embedcache-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);

// Counting embedder: irrational components so Float32 roundtrip is actually exercised.
const countingEmbed = () => {
  let calls = 0;
  const embed = async (t: string) => {
    calls++;
    return [Math.sin(t.length + 1) * 0.7, Math.cos(t.length) * 0.3, 0.123456789];
  };
  return { embed, count: () => calls };
};

// F0 — the cache sits between brain.ts and the contract embedder. If it drops the
// `role` argument, every document write silently gets the QUERY prefix; if it keys
// only on text, a document and a query vector for the same string collide. Both are
// silent corruptions that no downstream assertion would catch.
describe("embed-cache — F0 role passthrough", () => {
  test("forwards the role to the underlying embedder", async () => {
    const db = new DatabaseSync(":memory:");
    const c = createEmbedCache({ db, provider: "p1" });
    const seen: (string | undefined)[] = [];
    const wrapped = c.wrap(async (t, role) => { seen.push(role); return [t.length, 0, 0]; });
    await wrapped("hello", "document");
    await wrapped("hello", "query");
    expect(seen).toEqual(["document", "query"]);
  });

  test("cache key includes role — document and query of same text do NOT collide", async () => {
    const db = new DatabaseSync(":memory:");
    const c = createEmbedCache({ db, provider: "p1" });
    let calls = 0;
    const wrapped = c.wrap(async (_t, role) => { calls++; return role === "document" ? [1, 0, 0] : [0, 1, 0]; });
    const d = await wrapped("same text", "document");
    const q = await wrapped("same text", "query");
    expect(calls).toBe(2);
    expect(d).toEqual([1, 0, 0]);
    expect(q).toEqual([0, 1, 0]);
  });

  test("same role still memoizes (the cache must not become a no-op)", async () => {
    const db = new DatabaseSync(":memory:");
    const c = createEmbedCache({ db, provider: "p1" });
    let calls = 0;
    const wrapped = c.wrap(async () => { calls++; return [1, 0, 0]; });
    await wrapped("x", "document");
    await wrapped("x", "document");
    expect(calls).toBe(1);
    expect(c.stats().memHits).toBe(1);
  });
});

describe("embed-cache — memoization", () => {
  test("second embed of same text is a memory hit (underlying embedder called once)", async () => {
    const db = new DatabaseSync(":memory:");
    const c = createEmbedCache({ db, provider: "p1" });
    const { embed, count } = countingEmbed();
    const wrapped = c.wrap(embed);
    const v1 = await wrapped("hello world");
    const v2 = await wrapped("hello world");
    expect(count()).toBe(1);
    expect(v2).toEqual(v1);
    expect(c.stats().memHits).toBe(1);
    expect(c.stats().misses).toBe(1);
  });

  test("cache key includes provider — same text, other provider misses", async () => {
    const db = new DatabaseSync(":memory:");
    const { embed, count } = countingEmbed();
    const a = createEmbedCache({ db, provider: "prov-a" }).wrap(embed);
    const b = createEmbedCache({ db, provider: "prov-b" }).wrap(embed);
    await a("same text");
    await b("same text");
    expect(count()).toBe(2);
  });

  test("persists across cache instances: fresh instance hits the db, not the embedder", async () => {
    const p = tmpDb();
    const { embed, count } = countingEmbed();
    const db1 = new DatabaseSync(p);
    const c1 = createEmbedCache({ db: db1, provider: "p1" });
    const original = await c1.wrap(embed)("durable text");
    db1.close();

    const db2 = new DatabaseSync(p);
    const c2 = createEmbedCache({ db: db2, provider: "p1" });
    const revived = await c2.wrap(embed)("durable text");
    expect(count()).toBe(1); // no re-embed
    expect(c2.stats().dbHits).toBe(1);
    // Float32 precision (~1e-7) — same as brain_vec storage.
    revived.forEach((x: number, i: number) => expect(x).toBeCloseTo(original[i], 6));
    db2.close();
  });

  test("in-mem LRU eviction falls back to db (memCapacity 2, third insert evicts first)", async () => {
    const db = new DatabaseSync(":memory:");
    const c = createEmbedCache({ db, provider: "p1", memCapacity: 2 });
    const { embed, count } = countingEmbed();
    const wrapped = c.wrap(embed);
    await wrapped("aa");
    await wrapped("bbb");
    await wrapped("cccc"); // evicts "aa" from mem
    await wrapped("aa"); // must come from db, not embedder
    expect(count()).toBe(3);
    expect(c.stats().dbHits).toBe(1);
    expect(c.stats().memSize).toBe(2);
  });

  test("sweep caps persistent rows, keeping most recently accessed", async () => {
    const db = new DatabaseSync(":memory:");
    let t = 1000;
    const c = createEmbedCache({ db, provider: "p1", now: () => ++t });
    const { embed } = countingEmbed();
    const wrapped = c.wrap(embed);
    for (const s of ["a", "bb", "ccc", "dddd", "eeeee"]) await wrapped(s);
    const { evicted } = c.sweep({ cap: 2 });
    expect(evicted).toBe(3);
    const left = (db.prepare("SELECT COUNT(*) AS n FROM embed_cache").get() as { n: number }).n;
    expect(left).toBe(2);
  });
});

describe("embed-cache — brain integration", () => {
  // F0 changed this contract, deliberately. remember() embeds with the "document" role
  // and recall() with "query"; under nomic's asymmetric task prefixes those are genuinely
  // DIFFERENT vectors, so they cannot share a cache entry. The pre-F0 single-embed result
  // was only reachable because both sides embedded the identical raw string.
  //
  // Real cost: a remember-then-recall of the same text now costs 2 embeds, not 1. The
  // cache still earns its keep on repeated recalls of the same query (asserted below).
  test("remember then recall of same content embeds TWICE — document ≠ query vector", async () => {
    const { embed, count } = countingEmbed();
    const b = createBrainStore({ dbPath: tmpDb(), embed, embedProvider: "count" });
    await b.remember({ id: "m1", tier: "learned", content: "espresso ritual" });
    await b.recall("espresso ritual", { k: 1 });
    expect(count()).toBe(2);
    b.close();
  });

  test("repeated recall of the same query still embeds ONCE (cache earns its keep)", async () => {
    const { embed, count } = countingEmbed();
    const b = createBrainStore({ dbPath: tmpDb(), embed, embedProvider: "count" });
    await b.remember({ id: "m1", tier: "learned", content: "espresso ritual" });
    await b.recall("espresso ritual", { k: 1 });
    const afterFirst = count();
    await b.recall("espresso ritual", { k: 1 });
    expect(count()).toBe(afterFirst); // same text + same role → cache hit
    b.close();
  });

  test("BRAIN_EMBED_CACHE=0 opts out", async () => {
    process.env.BRAIN_EMBED_CACHE = "0";
    try {
      const { embed, count } = countingEmbed();
      const b = createBrainStore({ dbPath: tmpDb(), embed, embedProvider: "count" });
      await b.remember({ id: "m1", tier: "learned", content: "espresso ritual" });
      await b.recall("espresso ritual", { k: 1 });
      expect(count()).toBe(2);
      b.close();
    } finally {
      delete process.env.BRAIN_EMBED_CACHE;
    }
  });

  test("brain sweep also caps the embed cache via BRAIN_EMBED_CACHE_CAP", async () => {
    process.env.BRAIN_EMBED_CACHE_CAP = "1";
    try {
      const { embed } = countingEmbed();
      const b = createBrainStore({ dbPath: tmpDb(), embed, embedProvider: "count" });
      await b.remember({ id: "m1", tier: "learned", content: "one" });
      await b.remember({ id: "m2", tier: "learned", content: "two two" });
      const r = b.sweep() as { swept: number; embedEvicted?: number };
      expect(r.embedEvicted).toBe(1);
      b.close();
    } finally {
      delete process.env.BRAIN_EMBED_CACHE_CAP;
    }
  });
});
