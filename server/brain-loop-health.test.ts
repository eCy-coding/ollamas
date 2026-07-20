// Loop sağlık özeti — sessiz başarısızlığı GÖRÜNÜR kılar.
import { describe, test, expect } from "vitest";
import { summarize, shouldRotate, parseMetrics, renderHealth, type TurnMetric } from "./brain-loop-health";

const m = (over: Partial<TurnMetric> = {}): TurnMetric =>
  ({ turn: 1, at: 1_000, ms: 100, wrote: true, ...over });

describe("summarize", () => {
  test("yazım oranı ve süre istatistikleri", () => {
    const h = summarize([m({ turn: 1, ms: 100 }), m({ turn: 2, ms: 300, wrote: false }), m({ turn: 3, ms: 200 })]);
    expect(h.turns).toBe(3);
    expect(h.wrote).toBe(2);
    expect(h.writeRate).toBeCloseTo(0.667, 2);
    expect(h.avgMs).toBe(200);
  });

  test("KUSUR-3 İMZASI: ardışık kuru tur sayılır", () => {
    // Tur 42-53 arası 12 ölü tur tam olarak böyle görünürdü — artık ölçülüyor.
    const dead = Array.from({ length: 12 }, (_, i) => m({ turn: 42 + i, wrote: false, skipped: "no-fresh-target" }));
    const h = summarize([m({ turn: 41, wrote: true }), ...dead]);
    expect(h.consecutiveDry).toBe(12);
    expect(h.kinds["no-fresh-target"]).toBe(12);
    expect(renderHealth(h)).toContain("HEDEF ÜRETİMİ İNCELE");
  });

  test("yazan son tur kuru sayacı sıfırlar", () => {
    const h = summarize([m({ turn: 1, wrote: false }), m({ turn: 2, wrote: true })]);
    expect(h.consecutiveDry).toBe(0);
  });

  test("strateji/uzman/atlama dağılımı sayılır", () => {
    const h = summarize([
      m({ turn: 1, strategy: "cold", expert: "ollamas" }),
      m({ turn: 2, strategy: "cold", expert: "odysseus" }),
      m({ turn: 3, strategy: "backlog", wrote: false, skipped: "gpu-busy" }),
    ]);
    expect(h.strategies).toEqual({ cold: 2, backlog: 1 });
    expect(h.experts).toEqual({ ollamas: 1, odysseus: 1 });
    expect(h.kinds).toEqual({ "gpu-busy": 1 });
  });

  test("boş girdi çökmez", () => {
    const h = summarize([]);
    expect(h.turns).toBe(0);
    expect(h.writeRate).toBe(0);
    expect(h.lastTurn).toBeNull();
    expect(typeof renderHealth(h)).toBe("string");
  });
});

describe("parseMetrics", () => {
  test("bozuk satır TÜM özeti düşürmez", () => {
    const text = `${JSON.stringify(m({ turn: 1 }))}\n{ bozuk\n\n${JSON.stringify(m({ turn: 2 }))}\n`;
    expect(parseMetrics(text).map((x) => x.turn)).toEqual([1, 2]);
  });
  test("turn alanı olmayan satır atlanır", () => {
    expect(parseMetrics(`{"foo":1}`)).toEqual([]);
  });
});

describe("shouldRotate", () => {
  test("tavan aşılınca döndürülür", () => {
    expect(shouldRotate(6_000_000, 5_000_000)).toBe(true);
    expect(shouldRotate(1_000, 5_000_000)).toBe(false);
  });
});
