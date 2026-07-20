// ε-greedy keşif — tekrarlanabilir, sıfır-gerileme garantili.
import { describe, test, expect } from "vitest";
import { fnv1a, mulberry32, exploreSelect } from "./brain-explore";

const all = [true, true, true];

describe("fnv1a / mulberry32 — determinizm", () => {
  test("aynı metin aynı tohum", () => {
    expect(fnv1a("soru")).toBe(fnv1a("soru"));
    expect(fnv1a("soru")).not.toBe(fnv1a("baska"));
  });
  test("aynı tohum aynı dizi", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  test("çıktı [0,1) aralığında", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("exploreSelect", () => {
  test("ε=0 ⇒ DAİMA argmax (sıfır-gerileme kanıtı)", () => {
    // Canlı HTTP yolu bunu kullanır: kullanıcı sorgusu keşif kurbanı olmaz.
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const r = exploreSelect([0.1, 0.2, 0.7], all, { epsilon: 0, rng });
      expect(r).toEqual({ index: 2, explored: false });
    }
  });

  test("ε=1 ⇒ argmax ASLA seçilmez, hep keşif", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 30; i++) {
      const r = exploreSelect([0.1, 0.2, 0.7], all, { epsilon: 1, rng });
      expect(r.explored).toBe(true);
      expect(r.index).not.toBe(2);
    }
  });

  test("aynı tohumla aynı karar dizisi (tekrarlanabilir)", () => {
    const seq = () => {
      const rng = mulberry32(99);
      return Array.from({ length: 20 }, () => exploreSelect([0.2, 0.3, 0.5], all, { epsilon: 0.5, rng }).index);
    };
    expect(seq()).toEqual(seq());
  });

  test("keşfedilen indeks DAİMA erişilebilir olanlardan", () => {
    const rng = mulberry32(5);
    const avail = [true, false, true]; // ecym erişilemez
    for (let i = 0; i < 40; i++) {
      const r = exploreSelect([0.6, 0.9, 0.3], avail, { epsilon: 0.8, rng });
      expect(avail[r.index]).toBe(true);
    }
  });

  test("tek erişilebilir uzman varsa keşif YAPILMAZ", () => {
    const r = exploreSelect([0.1, 0.9, 0.2], [false, true, false], { epsilon: 1, rng: mulberry32(3) });
    expect(r).toEqual({ index: 1, explored: false });
  });

  test("hiç erişilebilir uzman yoksa -1", () => {
    const r = exploreSelect([0.1, 0.2, 0.7], [false, false, false], { epsilon: 0.5, rng: mulberry32(1) });
    expect(r.index).toBe(-1);
  });

  test("argmax erişilemezse erişilebilirlerin en iyisi seçilir", () => {
    const r = exploreSelect([0.1, 0.2, 0.9], [true, true, false], { epsilon: 0, rng: mulberry32(1) });
    expect(r.index).toBe(1);
  });

  test("bozuk ε değerleri güvenli kırpılır", () => {
    const rng = mulberry32(1);
    expect(exploreSelect([0.1, 0.9], [true, true], { epsilon: NaN, rng }).explored).toBe(false);
    expect(exploreSelect([0.1, 0.9], [true, true], { epsilon: -5, rng }).explored).toBe(false);
    expect(exploreSelect([0.1, 0.9], [true, true], { epsilon: 99, rng }).explored).toBe(true);
  });

  test("keşif oranı ε'a yakın çıkar (istatistiksel duyarlılık)", () => {
    const rng = mulberry32(2026);
    let explored = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (exploreSelect([0.1, 0.2, 0.7], all, { epsilon: 0.15, rng }).explored) explored++;
    }
    expect(explored / N).toBeGreaterThan(0.12);
    expect(explored / N).toBeLessThan(0.18);
  });
});
