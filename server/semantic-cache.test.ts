// server/semantic-cache.test.ts — TDD suite for the in-house semantic LLM
// response cache (C4). Pure core (lookupCache/storeCache/cleanupExpiredCache) with
// injected fake embedder + temp sqlite — no network, no real ollama.
import { describe, test, expect, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdapter, type DbClient } from "./store/db-adapter";
import { openVectorCollection, type VectorStore } from "./store/vector";
import {
  initSemanticCacheSchema,
  lookupCache,
  storeCache,
  cleanupExpiredCache,
  computePromptText,
  computeParamsHash,
  computeExactHash,
  normalizeVector,
  cosineFromL2Dist,
  normalizingEmbedder,
  resolveThreshold,
  resolveTtlS,
  type CacheDeps,
  type CacheParams,
  type StoredResult,
} from "./semantic-cache";

const dbFiles: string[] = [];
const vecDirs: string[] = [];

async function freshDb(tag: string): Promise<DbClient> {
  const file = path.join(os.tmpdir(), `ollamas-semcache-${process.pid}-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
  dbFiles.push(file);
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = file;
  const db = await createAdapter();
  await initSemanticCacheSchema(db);
  return db;
}

/** angle-controlled 2D vectors so cosine similarity between "base" and a variant
 *  is exactly cos(angleDeg) — lets the near/below-threshold tests be exact. */
function vecAtAngle(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

function makeDeps(tag: string, embedMap: Record<string, number[]>, env: NodeJS.ProcessEnv): { deps: Promise<CacheDeps>; close: () => void } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ollamas-semcache-vec-${tag}-`));
  vecDirs.push(baseDir);
  const rawEmbed = async (text: string): Promise<number[]> => {
    if (text in embedMap) return embedMap[text];
    throw new Error(`no fake embedding registered for "${text}"`);
  };
  let vec: VectorStore;
  const deps = (async (): Promise<CacheDeps> => {
    const db = await freshDb(tag);
    vec = openVectorCollection(`sc-${tag}`, { baseDir, embed: normalizingEmbedder(rawEmbed) });
    return { db, vec, env };
  })();
  return { deps, close: () => { try { vec?.close(); } catch {} } };
}

const cfg = (overrides: Partial<CacheParams> = {}): CacheParams => ({
  model: "gpt-test",
  messages: [{ role: "user", content: "hello world" }],
  temperature: 0.7,
  ...overrides,
});

const result = (text = "cached answer"): StoredResult => ({
  text, source: "cloud:test", modelUsed: "gpt-test", tokens: 5, tokensIn: 3, tokensOut: 5,
});

const ENABLED = { SEMANTIC_CACHE: "1" } as unknown as NodeJS.ProcessEnv;

afterAll(() => {
  for (const file of dbFiles) for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
  for (const d of vecDirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
});

describe("pure helpers", () => {
  test("computePromptText folds role:content per message", () => {
    expect(computePromptText([{ role: "user", content: "hi" }, { role: "system", content: "sys" }]))
      .toBe("user:hi\nsystem:sys");
  });

  test("computeParamsHash differs when temperature differs, same otherwise", () => {
    const a = computeParamsHash({ temperature: 0.7 });
    const b = computeParamsHash({ temperature: 0.9 });
    const c = computeParamsHash({ temperature: 0.7 });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });

  test("computeExactHash is deterministic and prompt-sensitive", () => {
    const h1 = computeExactHash("m", "prompt A", "ph");
    const h2 = computeExactHash("m", "prompt A", "ph");
    const h3 = computeExactHash("m", "prompt B", "ph");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  test("normalizeVector produces a unit vector", () => {
    const n = normalizeVector([3, 4]);
    expect(Math.hypot(...n)).toBeCloseTo(1, 10);
  });

  test("normalizeVector guards the zero vector", () => {
    expect(normalizeVector([0, 0])).toEqual([0, 0]);
  });

  test("cosineFromL2Dist: identical unit vectors -> 1, orthogonal -> 0", () => {
    expect(cosineFromL2Dist(0)).toBeCloseTo(1, 10);
    expect(cosineFromL2Dist(Math.SQRT2)).toBeCloseTo(0, 10); // ||a-b|| = sqrt(2) for orthogonal unit vectors
  });

  test("resolveThreshold / resolveTtlS: env override + sane defaults", () => {
    expect(resolveThreshold({} as NodeJS.ProcessEnv)).toBe(0.95);
    expect(resolveThreshold({ SEMANTIC_CACHE_THRESHOLD: "0.8" } as NodeJS.ProcessEnv)).toBe(0.8);
    expect(resolveThreshold({ SEMANTIC_CACHE_THRESHOLD: "bogus" } as NodeJS.ProcessEnv)).toBe(0.95);
    expect(resolveTtlS({} as NodeJS.ProcessEnv)).toBe(3600);
    expect(resolveTtlS({ SEMANTIC_CACHE_TTL_S: "60" } as NodeJS.ProcessEnv)).toBe(60);
  });
});

describe("lookupCache / storeCache (injected sqlite + fake embedder)", () => {
  test("exact hit: identical request returns the stored result", async () => {
    const c = cfg();
    const { deps, close } = makeDeps("exact", { "user:hello world": vecAtAngle(0) }, ENABLED);
    const d = await deps;
    await storeCache(d, c, result("A"));
    const hit = await lookupCache(d, c);
    expect(hit).not.toBeNull();
    expect(hit!.outcome).toBe("hit_exact");
    expect(hit!.result.text).toBe("A");
    close();
  });

  test("semantic hit: near-duplicate prompt (cosine >= threshold) returns the stored result", async () => {
    const stored = cfg({ messages: [{ role: "user", content: "base" }] });
    const query = cfg({ messages: [{ role: "user", content: "near" }] });
    // angle 10deg -> cosine ~0.9848, clears the default 0.95 threshold
    const { deps, close } = makeDeps("semhit", {
      "user:base": vecAtAngle(0),
      "user:near": vecAtAngle(10),
    }, ENABLED);
    const d = await deps;
    await storeCache(d, stored, result("B"));
    const hit = await lookupCache(d, query);
    expect(hit).not.toBeNull();
    expect(hit!.outcome).toBe("hit_semantic");
    expect(hit!.result.text).toBe("B");
    close();
  });

  test("below-threshold: cosine < threshold -> miss", async () => {
    const stored = cfg({ messages: [{ role: "user", content: "base" }] });
    const query = cfg({ messages: [{ role: "user", content: "far" }] });
    // angle 30deg -> cosine ~0.866, below the default 0.95 threshold
    const { deps, close } = makeDeps("belowthresh", {
      "user:base": vecAtAngle(0),
      "user:far": vecAtAngle(30),
    }, ENABLED);
    const d = await deps;
    await storeCache(d, stored, result("C"));
    const hit = await lookupCache(d, query);
    expect(hit).toBeNull();
    close();
  });

  test("near-miss telemetry: below-threshold cosine inside the 0.1 band logs one evidence line", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const stored = cfg({ messages: [{ role: "user", content: "base" }] });
      const query = cfg({ messages: [{ role: "user", content: "far" }] });
      // angle 30deg -> cosine ~0.866: a miss, but inside [threshold-0.1, threshold)
      const { deps, close } = makeDeps("nearmiss", {
        "user:base": vecAtAngle(0),
        "user:far": vecAtAngle(30),
      }, ENABLED);
      const d = await deps;
      await storeCache(d, stored, result("N"));
      expect(await lookupCache(d, query)).toBeNull();
      const line = infoSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes("semantic_cache.near_miss"));
      expect(line).toBeTruthy();
      const evt = JSON.parse(line!);
      expect(evt.cosine).toBeCloseTo(0.866, 2);
      expect(evt.threshold).toBe(0.95);
      close();
    } finally { infoSpy.mockRestore(); }
  });

  test("param-mismatch: same model+prompt-family, different params hash -> miss", async () => {
    const stored = cfg({ messages: [{ role: "user", content: "base" }], temperature: 0.2 });
    const query = cfg({ messages: [{ role: "user", content: "near" }], temperature: 0.9 });
    const { deps, close } = makeDeps("parammismatch", {
      "user:base": vecAtAngle(0),
      "user:near": vecAtAngle(1), // near-identical vector, would otherwise hit_semantic
    }, ENABLED);
    const d = await deps;
    await storeCache(d, stored, result("D"));
    const hit = await lookupCache(d, query);
    expect(hit).toBeNull();
    close();
  });

  test("TTL expiry: exact-hash row past its TTL is treated as a miss (and lazily deleted)", async () => {
    const c = cfg();
    const { deps, close } = makeDeps("ttl", { "user:hello world": vecAtAngle(0) }, { ...ENABLED, SEMANTIC_CACHE_TTL_S: "60" } as unknown as NodeJS.ProcessEnv);
    const d = await deps;
    const t0 = 1_000_000;
    await storeCache(d, c, result("E"), t0);
    const stillFresh = await lookupCache(d, c, t0 + 30_000); // 30s later, within 60s TTL
    expect(stillFresh?.outcome).toBe("hit_exact");
    const expired = await lookupCache(d, c, t0 + 61_000); // 61s later, past TTL
    expect(expired).toBeNull();
    const row = (await d.db.query("SELECT * FROM semantic_cache WHERE id = ?", [computeExactHash(c.model, computePromptText(c.messages), computeParamsHash(c))])).rows[0];
    expect(row).toBeUndefined(); // lazily deleted
    close();
  });

  test("disabled passthrough: SEMANTIC_CACHE unset -> lookup/store are no-ops, no IO", async () => {
    const c = cfg();
    const disabledEnv = {} as NodeJS.ProcessEnv;
    const { deps, close } = makeDeps("disabled", { "user:hello world": vecAtAngle(0) }, disabledEnv);
    const d = await deps;
    await storeCache(d, c, result("F")); // no-op — disabled
    const hit = await lookupCache(d, c); // no-op — disabled
    expect(hit).toBeNull();
    const row = (await d.db.query("SELECT * FROM semantic_cache WHERE id = ?", [computeExactHash(c.model, computePromptText(c.messages), computeParamsHash(c))])).rows[0];
    expect(row).toBeUndefined(); // storeCache never wrote anything
    close();
  });

  test("error-isolation: embedder throws on the semantic path -> miss, not a thrown error", async () => {
    const c = cfg({ messages: [{ role: "user", content: "unregistered prompt" }] });
    // no entries in the embed map -> rawEmbed throws for ANY prompt
    const { deps, close } = makeDeps("errisolation", {}, ENABLED);
    const d = await deps;
    await expect(lookupCache(d, c)).resolves.toBeNull();
    close();
  });
});

describe("cleanupExpiredCache", () => {
  test("removes only rows past their TTL", async () => {
    const { deps, close } = makeDeps("cleanup", {
      "user:keep": vecAtAngle(0),
      "user:drop": vecAtAngle(90),
    }, ENABLED);
    const d = await deps;
    const t0 = 2_000_000;
    await storeCache(d, cfg({ messages: [{ role: "user", content: "keep" }] }), result("keep"), t0);
    await storeCache(d, cfg({ messages: [{ role: "user", content: "drop" }] }), result("drop"), t0 - 10_000_000); // long-expired
    const removed = await cleanupExpiredCache(d.db, d.vec, t0);
    expect(removed).toBe(1);
    const rows = (await d.db.query("SELECT id FROM semantic_cache")).rows;
    expect(rows.length).toBe(1);
    close();
  });
});
