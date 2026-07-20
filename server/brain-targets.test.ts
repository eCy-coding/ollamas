// Sonsuz loop hedef üreteci — TÜKENMEZLİK sözleşmesi.
// Kusur-3 kanıtı (2026-07-20): sabit sorgu + kalıcı askedHashes → tur 42-53 kesintisiz
// "no-fresh-target". Buradaki testler o kusurun bir daha oluşamayacağını kilitler.
import { describe, test, expect } from "vitest";
import {
  STRATEGIES, pickStrategy, targetsFor, freshTargets, migrateAsked, pushBacklog,
  questionFromRecord, hashQuestion, DEFAULT_TTL_MS, type TargetInput,
} from "./brain-targets";

describe("strateji rotasyonu — tam devir", () => {
  test("ardışık turlar her stratejiyi tam olarak bir kez gezer", () => {
    const seen = Array.from({ length: STRATEGIES.length }, (_, i) => pickStrategy(i));
    expect(new Set(seen).size).toBe(STRATEGIES.length); // hiçbiri atlanmıyor
    expect(pickStrategy(0)).toBe(pickStrategy(STRATEGIES.length)); // devir kapanıyor
  });

  test("negatif/taşan tur numarası çökmez", () => {
    expect(STRATEGIES).toContain(pickStrategy(-1));
    expect(STRATEGIES).toContain(pickStrategy(Number.MAX_SAFE_INTEGER));
  });
});

describe("freshTargets — TÜKENMEZLİK garantisi (kusur 3'ün kilidi)", () => {
  const cands = ["soru bir", "soru iki", "soru üç"];

  test("hiç sorulmamış adaylar taze", () => {
    expect(freshTargets(cands, {}, 1_000, DEFAULT_TTL_MS)).toEqual(cands);
  });

  test("yeni sorulmuş adaylar elenir", () => {
    const asked = Object.fromEntries(cands.map((c) => [hashQuestion(c), 1_000]));
    expect(freshTargets(cands, asked, 1_000, DEFAULT_TTL_MS)).toEqual([]);
  });

  test("TTL dolunca HEPSİ yeniden taze — havuz asla kalıcı tükenmez", () => {
    const t0 = 1_000;
    const asked = Object.fromEntries(cands.map((c) => [hashQuestion(c), t0]));
    // Bu, eski davranışın (kalıcı askedHashes) matematiksel panzehiri:
    const later = t0 + DEFAULT_TTL_MS + 1;
    expect(freshTargets(cands, asked, later, DEFAULT_TTL_MS)).toEqual(cands);
  });

  test("kısmi tazelik: yalnız süresi dolanlar döner", () => {
    const t0 = 1_000;
    const asked = {
      [hashQuestion(cands[0])]: t0,                    // eski → taze sayılır
      [hashQuestion(cands[1])]: t0 + DEFAULT_TTL_MS,   // yeni → elenir
    };
    const now = t0 + DEFAULT_TTL_MS + 1;
    expect(freshTargets(cands, asked, now, DEFAULT_TTL_MS)).toEqual([cands[0], cands[2]]);
  });

  test("boş aday kümesi boş döner (çökmez)", () => {
    expect(freshTargets([], {}, 1, DEFAULT_TTL_MS)).toEqual([]);
  });
});

describe("migrateAsked — eski dizi formatı göçü", () => {
  test("string[] → Record<hash, ts> (geriye dönük uyum)", () => {
    const m = migrateAsked(["aaa", "bbb"]);
    expect(m).toEqual({ aaa: 0, bbb: 0 });
    // ts=0 → derhal TTL'i aşmış sayılır, yani eski kayıtlar loop'u kilitlemez.
    expect(freshTargets(["x"], { [hashQuestion("x")]: 0 }, DEFAULT_TTL_MS + 1, DEFAULT_TTL_MS)).toEqual(["x"]);
  });

  test("zaten Record ise aynen korunur; undefined → boş", () => {
    expect(migrateAsked({ a: 5 })).toEqual({ a: 5 });
    expect(migrateAsked(undefined)).toEqual({});
  });
});

describe("pushBacklog — FIFO + tekilleştirme + tavan", () => {
  test("yeni adaylar sona eklenir, kopyalar yok sayılır", () => {
    expect(pushBacklog(["a"], ["b", "a", "c"], 10)).toEqual(["a", "b", "c"]);
  });

  test("tavan aşılırsa EN ESKİ düşer (FIFO)", () => {
    expect(pushBacklog(["a", "b"], ["c"], 2)).toEqual(["b", "c"]);
  });
});

describe("questionFromRecord — deterministik, LLM'siz", () => {
  test("tırnaklı özne tercih edilir", () => {
    expect(questionFromRecord("ollamas kod-deseni 'guarded-alter': şema evrimi ALTER ile.")).toBe(
      "guarded-alter nedir, ollamas'ta nasıl kullanılır?",
    );
  });
  test("tırnak yoksa özetleme sorusu", () => {
    expect(questionFromRecord("Brain servisi recall-hybrid vektör+BM25 fusion yapar")).toContain("özetle");
  });
  test("boş içerik çökmez", () => {
    expect(typeof questionFromRecord("")).toBe("string");
  });
});

describe("targetsFor — her strateji üretken ve saf", () => {
  const input: TargetInput = {
    hits: [
      { id: "m1", content: "ollamas kod-deseni 'guarded-alter': şema evrimi.", conf: 0.9, usage: 0 },
      { id: "m2", content: "Brain 'recall-hybrid' vektör+BM25 birleştirir.", conf: 0.4, usage: 7 },
    ],
    facts: [
      { subject: "odysseus", predicate: "port", object: "7860", conf: 0.9 },
      { subject: "odysseus", predicate: "port", object: "4777", conf: 0.5 },
      { subject: "brain", predicate: "store", object: "sqlite-vec", conf: 0.3 },
    ],
    namespaces: [{ ns: "knowledge", count: 900 }, { ns: "research", count: 2 }],
    backlog: ["birikmiş soru"],
  };

  test("her strateji string[] döndürür ve girdiyi MUTASYONA UĞRATMAZ", () => {
    const snapshot = JSON.stringify(input);
    for (const s of STRATEGIES) {
      const out = targetsFor(s, input);
      expect(Array.isArray(out)).toBe(true);
      expect(out.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    }
    expect(JSON.stringify(input)).toBe(snapshot); // saflık
  });

  test("cold: en az kullanılan kayıt önce", () => {
    const out = targetsFor("cold", input);
    expect(out[0]).toContain("guarded-alter"); // usage=0 olan
  });

  test("lowconf: yalnız düşük-güven kaynaklar hedeflenir", () => {
    const out = targetsFor("lowconf", input);
    expect(out.join(" ")).toContain("recall-hybrid"); // conf 0.4
    expect(out.join(" ")).not.toContain("guarded-alter"); // conf 0.9 → hedef değil
  });

  test("contradiction: aynı özne+yüklem, farklı nesne → çelişki sorusu", () => {
    const out = targetsFor("contradiction", input);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain("odysseus");
    expect(out[0]).toContain("7860");
    expect(out[0]).toContain("4777");
  });

  test("coverage: az kayıtlı namespace hedeflenir", () => {
    const out = targetsFor("coverage", input);
    expect(out.join(" ")).toContain("research"); // count=2
    expect(out.join(" ")).not.toContain("knowledge"); // count=900 → boşluk yok
  });

  test("backlog: birikmiş kuyruğu drene eder", () => {
    expect(targetsFor("backlog", input)).toEqual(["birikmiş soru"]);
  });

  test("boş girdi her stratejide boş döner, çökmez", () => {
    for (const s of STRATEGIES) expect(targetsFor(s, {})).toEqual([]);
  });
});
