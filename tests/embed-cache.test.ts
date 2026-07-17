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
  test("remember then recall of same content embeds ONCE (default-on cache)", async () => {
    const { embed, count } = countingEmbed();
    const b = createBrainStore({ dbPath: tmpDb(), embed, embedProvider: "count" });
    await b.remember({ id: "m1", tier: "learned", content: "espresso ritual" });
    await b.recall("espresso ritual", { k: 1 });
    expect(count()).toBe(1); // recall query == remembered content → cache hit
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
