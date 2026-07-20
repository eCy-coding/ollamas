// Terfi kapısı — "hatasız olan otonom başlar" kuralının kilidi.
import { describe, test, expect } from "vitest";
import {
  emptyCap, emptyLedger, recordRun, evaluate, summarize, demote, reset,
  autonomousIds, sandboxIdFor, renderTable, DEFAULT_WINDOW, RUN_HISTORY,
  type Cap, type Run,
} from "./brain-capabilities";

const run = (over: Partial<Run> = {}): Run =>
  ({ turn: 1, at: 1_000, mode: "sandbox", ok: true, ms: 100, ...over });

/** n adet koşuyu sırayla işle. */
const feed = (cap: Cap, n: number, over: Partial<Run> = {}): Cap => {
  let c = cap;
  for (let i = 0; i < n; i++) c = recordRun(c, run({ turn: i, at: 1_000 + i, ...over }), 1_000 + i);
  return c;
};

describe("sandbox → candidate", () => {
  test("hatasız ve bütçe içinde yeterli koşu → aday", () => {
    const c = feed(emptyCap("reatt-rerank"), 10);
    expect(c.status).toBe("candidate");
    expect(c.baseline).toBeDefined(); // terfide taban çizgisi dondurulur
  });

  test("yetersiz koşu terfi ettirmez", () => {
    expect(feed(emptyCap("x"), 9).status).toBe("sandbox");
  });

  test("TEK sandbox hatası terfiyi engeller (maxErrors=0)", () => {
    let c = feed(emptyCap("x"), 9);
    c = recordRun(c, run({ turn: 9, ok: false, err: "patladı" }), 2_000);
    expect(c.status).toBe("sandbox");
    expect(evaluate(c).reason).toContain("hata");
  });

  test("bütçeyi aşan süre terfiyi engeller", () => {
    const c = feed(emptyCap("x"), 12, { ms: 45_000 });
    expect(c.status).toBe("sandbox");
    expect(evaluate(c).reason).toContain("p95");
  });
});

describe("candidate → autonomous", () => {
  test("canlı-gölge penceresi de geçilirse otonom", () => {
    let c = feed(emptyCap("x"), 10);            // → candidate
    expect(c.status).toBe("candidate");
    c = feed(c, 10, { mode: "live" });          // canlı pencere
    expect(c.status).toBe("autonomous");
  });

  test("canlı koşu yetersizse aday olarak kalır", () => {
    let c = feed(emptyCap("x"), 10);
    c = feed(c, 3, { mode: "live" });
    expect(c.status).toBe("candidate");
  });
});

describe("karantina — canlıda tek hata yeter", () => {
  test("otonom yetenek canlı hatada ANINDA karantinaya alınır", () => {
    let c = feed(emptyCap("x"), 10);
    c = feed(c, 10, { mode: "live" });
    expect(c.status).toBe("autonomous");
    c = recordRun(c, run({ turn: 99, mode: "live", ok: false, err: "boom" }), 9_000);
    expect(c.status).toBe("quarantined");
    expect(c.quarantine?.reason).toContain("boom");
  });

  test("karantina TEK YÖNLÜ — kendiliğinden çıkamaz", () => {
    let c = demote(emptyCap("x"), "elle", 1_000);
    c = feed(c, 30);                       // sonrasında ne kadar başarılı koşarsa koşsun
    expect(c.status).toBe("quarantined");
    expect(evaluate(c).reason).toContain("reset");
  });

  test("reset temiz sayfa açar", () => {
    const c = reset(demote(feed(emptyCap("x"), 10), "boom", 2_000), 3_000);
    expect(c.status).toBe("sandbox");
    expect(c.runs).toEqual([]);
    expect(c.quarantine).toBeUndefined();
  });
});

describe("kalite gerilemesi", () => {
  test("taban çizgisinin altına düşen kalite terfi ettirmez", () => {
    let c = feed(emptyCap("x"), 10, { metric: 0.9 });   // → candidate, baseline 0.9
    expect(c.status).toBe("candidate");
    expect(c.baseline?.metric).toBeCloseTo(0.9, 3);
    c = feed(c, 10, { mode: "live", metric: 0.5 });     // belirgin gerileme
    expect(c.status).toBe("candidate");                  // otonom OLMAZ
    expect(evaluate(c).reason).toContain("kalite düştü");
  });

  test("taban çizgisi yoksa gerileme İDDİA EDİLEMEZ (delta 0)", () => {
    const c = emptyCap("x");
    expect(summarize(c, "sandbox").metricDelta).toBe(0);
  });
});

describe("defter yardımcıları", () => {
  test("autonomousIds yalnız otonomları verir", () => {
    const l = emptyLedger();
    l.caps.a = feed(feed(emptyCap("a"), 10), 10, { mode: "live" });
    l.caps.b = emptyCap("b");
    expect(autonomousIds(l)).toEqual(["a"]);
  });

  test("sandboxIdFor tur başına TEK yetenek seçer ve döner", () => {
    const l = emptyLedger();
    l.caps.a = emptyCap("a");
    l.caps.b = emptyCap("b");
    expect(sandboxIdFor(l, 0)).toBe("a");
    expect(sandboxIdFor(l, 1)).toBe("b");
    expect(sandboxIdFor(l, 2)).toBe("a");           // devir
    expect(sandboxIdFor(l, -1)).not.toBeNull();     // negatif tur çökmez
    expect(sandboxIdFor(emptyLedger(), 0)).toBeNull();
  });

  test("otonom/karantina yetenekler sandbox sırasına girmez", () => {
    const l = emptyLedger();
    l.caps.a = demote(emptyCap("a"), "x", 1);
    expect(sandboxIdFor(l, 0)).toBeNull();
  });

  test("koşu geçmişi tavanlanır", () => {
    expect(feed(emptyCap("x"), RUN_HISTORY + 30).runs.length).toBe(RUN_HISTORY);
  });

  test("renderTable sayı basar, boş defterde çökmez", () => {
    expect(renderTable(emptyLedger())).toContain("yok");
    const l = emptyLedger();
    l.caps.a = feed(emptyCap("a"), 5);
    expect(renderTable(l)).toContain("sandbox");
  });
});

describe("summarize penceresi", () => {
  test("yalnız istenen moddaki son N koşuyu sayar", () => {
    let c = feed(emptyCap("x"), 5, { mode: "sandbox" });
    c = feed(c, 3, { mode: "live" });
    expect(summarize(c, "sandbox").n).toBe(5);
    expect(summarize(c, "live").n).toBe(3);
    expect(summarize(c, "sandbox", 2).n).toBe(2);
  });

  test("p95 uç değeri yakalar", () => {
    let c = emptyCap("x");
    c = feed(c, 19, { ms: 100 });
    c = recordRun(c, run({ turn: 99, ms: 50_000 }), 5_000);
    expect(summarize(c, "sandbox", DEFAULT_WINDOW).p95Ms).toBeGreaterThan(100);
  });
});
