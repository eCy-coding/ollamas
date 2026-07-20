// ReAtt sarmalayıcısı + gömme önbelleği.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitSentences, rerank, reattRerank, mrr, MAX_EMBEDS_PER_RUN } from "./brain-reatt";
import { openEmbedCache, cacheKey, evictLru, CACHE_CAP } from "./brain-embed-cache";
import type { AskSource } from "./brain-ask";

const src = (id: string, excerpt: string, score: number): AskSource =>
  ({ id, tier: "learned", score, excerpt });

describe("splitSentences", () => {
  test("nokta/soru/ünlem ve satır sonundan böler", () => {
    const s = splitSentences("Birinci cümle burada. İkinci cümle burada! Üçüncü cümle burada?");
    expect(s.length).toBe(3);
    expect(s[0]).toContain("Birinci");
  });
  test("kısa gürültü parçaları atılır", () => {
    expect(splitSentences("ok. Bu yeterince uzun bir cümledir burada.")).toEqual([
      "Bu yeterince uzun bir cümledir burada.",
    ]);
  });
  test("tavan uygulanır", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Bu ${i} numarali yeterince uzun cumle.`).join(" ");
    expect(splitSentences(many, 3).length).toBe(3);
  });
  test("boş girdi çökmez", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("rerank", () => {
  test("skora göre azalan; eşitlikte id ile deterministik", () => {
    expect(rerank([{ id: "b", score: 1 }, { id: "a", score: 1 }, { id: "c", score: 5 }]))
      .toEqual(["c", "a", "b"]);
  });
});

describe("mrr", () => {
  test("üstteki hedef daha yüksek MRR verir", () => {
    expect(mrr(["a", "b", "c"], ["a"])).toBeCloseTo(1, 6);
    expect(mrr(["a", "b", "c"], ["c"])).toBeCloseTo(1 / 3, 6);
  });
  test("bulunmayan hedef 0 katkı yapar", () => {
    expect(mrr(["a", "b"], ["z"])).toBe(0);
  });
  test("boş girdi 0", () => {
    expect(mrr([], ["a"])).toBe(0);
    expect(mrr(["a"], [])).toBe(0);
  });
});

describe("reattRerank", () => {
  const e1 = [1, 0, 0], e2 = [0, 1, 0];
  // "kahve" cümlesi e1'e, "dagitim" cümlesi e2'ye gömülür.
  const fakeEmbed = async (t: string) => ({
    vector: /kahve/i.test(t) ? e1 : e2,
    spaceId: "test-space",
  });
  const deps = () => ({ embed: fakeEmbed, cache: openEmbedCache(join(tmpdir(), `c-${Math.random()}.json`)) });

  test("sorgusuyla eşleşen kaynak ÜSTE çıkar (retrieval sırası tersine dönebilir)", async () => {
    // Retrieval skoru dagitim'i üste koymuş; ReAtt sorguyla (e1=kahve) eşleşeni yükseltmeli.
    const sources = [
      src("m-dagitim", "Dagitim sistemi kuyruk ile calisir burada.", 0.9),
      src("m-kahve", "Kahve demleme yontemi burada anlatilir.", 0.5),
    ];
    const r = await reattRerank(e1, sources, deps());
    expect(r.original[0]).toBe("m-dagitim");   // retrieval sırası
    expect(r.reranked[0]).toBe("m-kahve");     // ReAtt sırası
  });

  test("gömme sayısı SERT TAVANI aşmaz", async () => {
    const sources = Array.from({ length: 12 }, (_, i) =>
      src(`m-${i}`, Array.from({ length: 10 }, (_, j) => `Bu ${i}-${j} numarali yeterince uzun cumledir.`).join(" "), 1));
    const r = await reattRerank(e1, sources, deps());
    expect(r.embeds).toBeLessThanOrEqual(MAX_EMBEDS_PER_RUN);
  });

  test("top-N dışındaki kaynaklar sıralamanın SONUNA düşer, kaybolmaz", async () => {
    const sources = Array.from({ length: 8 }, (_, i) =>
      src(`m-${i}`, `Bu ${i} numarali yeterince uzun bir cumledir.`, 8 - i));
    const r = await reattRerank(e1, sources, deps());
    expect(r.reranked.length).toBe(sources.length); // hiçbiri kaybolmadı
    expect(new Set(r.reranked)).toEqual(new Set(sources.map((s) => s.id)));
  });

  test("gömme boş dönerse skor 0, çökmez", async () => {
    const bos = { embed: async () => ({ vector: [] as number[], spaceId: "x" }), cache: deps().cache };
    const r = await reattRerank(e1, [src("m-1", "Yeterince uzun bir cumle burada.", 1)], bos);
    expect(r.scores["m-1"]).toBe(0);
  });

  test("kaynak yoksa boş sonuç", async () => {
    const r = await reattRerank(e1, [], deps());
    expect(r.reranked).toEqual([]);
    expect(r.embeds).toBe(0);
  });
});

describe("embed cache", () => {
  let dir = "";
  const prev = process.env.BRAIN_LOOP_DIR;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ec-")); process.env.BRAIN_LOOP_DIR = dir; });
  afterEach(() => {
    if (prev === undefined) delete process.env.BRAIN_LOOP_DIR; else process.env.BRAIN_LOOP_DIR = prev;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici */ }
  });

  test("SPACEID anahtara girer — model değişince eski vektör kullanılmaz", () => {
    // Sessiz uzay karışması sıralamayı bozar ve fark edilmez; anahtar ayrımı bunu önler.
    expect(cacheKey("nomic-v1", "metin")).not.toBe(cacheKey("baska-model", "metin"));
  });

  test("yaz-oku turu ve kalıcılık", () => {
    const p = join(dir, "c.json");
    const c = openEmbedCache(p);
    c.set("s1", "metin", [1, 2, 3]);
    expect(c.get("s1", "metin")).toEqual([1, 2, 3]);
    c.flush();
    expect(openEmbedCache(p).get("s1", "metin")).toEqual([1, 2, 3]);
  });

  test("farklı uzaydan okuma MISS verir", () => {
    const c = openEmbedCache(join(dir, "c.json"));
    c.set("s1", "metin", [1, 2, 3]);
    expect(c.get("s2", "metin")).toBeNull();
  });

  test("LRU tavanı: en ESKİ erişilen düşer", () => {
    const e = { a: { v: [1], at: 100 }, b: { v: [2], at: 300 }, c: { v: [3], at: 200 } };
    expect(Object.keys(evictLru(e, 2)).sort()).toEqual(["b", "c"]);
    expect(Object.keys(evictLru(e, 9))).toHaveLength(3); // tavan altında dokunulmaz
  });

  test("bozuk önbellek dosyası boş önbelleğe düşer (turu düşürmez)", () => {
    const p = join(dir, "bozuk.json");
    require("node:fs").writeFileSync(p, "{ bozuk json");
    expect(openEmbedCache(p).size()).toBe(0);
  });

  test("tavan makul", () => expect(CACHE_CAP).toBeGreaterThan(0));
});
