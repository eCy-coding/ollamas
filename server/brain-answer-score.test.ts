// DIŞSAL kalite sinyali — kusur G'nin panzehiri.
//
// Gate eskiden KENDİ argmax'ıyla eğitiliyordu: etiketi kendi tahmini olan bir öğrenici
// yetkinlik öğrenemez, yalnız başlangıç eğilimini büyütür (ölçüldü: son 11 yazımın 11'i
// tek uzmana gitti). Bu modül dışsal, deterministik, LLM'siz bir etiket üretir:
// uzmanın cevabı GERÇEKTEN getirilen kaynaklara dayanıyor mu?
import { describe, test, expect } from "vitest";
import { citationIds, scoreAnswer, scoreAll, citedRetentionInSet } from "./brain-answer-score";
import type { AskSource } from "./brain-ask";

const src = (id: string, excerpt: string): AskSource => ({ id, tier: "learned", score: 0.9, excerpt });

const SOURCES: AskSource[] = [
  src("m-1", "ollamas brain sqlite-vec ile calisir ve vektor aramasi yapar"),
  src("m-2", "gate softmax ile uzman agirliklarini uretir"),
];

describe("citationIds", () => {
  test("[mem:ID] biçimini çıkarır, tekilleştirir", () => {
    expect(citationIds("a [mem:m-1] b [mem:m-2] c [mem:m-1]")).toEqual(["m-1", "m-2"]);
  });
  test("atıf yoksa boş", () => {
    expect(citationIds("hiç atıf yok")).toEqual([]);
    expect(citationIds("")).toEqual([]);
  });
});

describe("citedRetentionInSet — YALNIZ ağırlıklandırmanın kontrol ettiğini ölçer", () => {
  // Kök hata (canlı ragseq-weighting'de ölçüldü): eski metrik `kept/cited.length`
  // cevabın KÜME-DIŞI bir id atıf yapmasını (kept=0) ağırlıklandırmanın kusuru sayıp
  // sahte retention=0 üretiyordu → sahte-mükemmel baseline'a takılıp terfiyi tıkadı.
  // Doğru metrik: retention YALNIZ küme-İÇİ atıflar üzerinden; küme-dışı atıf ragseq'in
  // kontrolünde değil. Küme-içi atıf yoksa metrik BELİRSİZ (undefined) — ortalamayı kirletmez.
  const ctxWith = (ids: string[]) => ids.map((i) => `[mem:${i}] içerik`).join("\n");

  test("küme-içi tüm atıflar bağlamda → 1.0", () => {
    expect(citedRetentionInSet(["m-1", "m-2"], ["m-1", "m-2", "m-3"], ctxWith(["m-1", "m-2", "m-3"]))).toBe(1);
  });

  test("KÜME-DIŞI atıf (kaynak setinde yok) → sahte 0 ÜRETMEZ, undefined döner", () => {
    // cevap m-9'u atıf yapmış ama retrieval setinde yok → ragseq suçlanamaz
    expect(citedRetentionInSet(["m-9"], ["m-1", "m-2"], ctxWith(["m-1", "m-2"]))).toBeUndefined();
  });

  test("küme-içi atıfın yarısı bağlamdan düşmüş → 0.5 (GERÇEK ağırlıklandırma sinyali)", () => {
    expect(citedRetentionInSet(["m-1", "m-2"], ["m-1", "m-2"], ctxWith(["m-1"]))).toBe(0.5);
  });

  test("hiç atıf yok → undefined (bilgi taşımaz)", () => {
    expect(citedRetentionInSet([], ["m-1"], ctxWith(["m-1"]))).toBeUndefined();
  });

  test("küme-dışı + küme-içi karışık → yalnız küme-içi sayılır", () => {
    // m-1 küme-içi ve bağlamda (kept), m-9 küme-dışı (yok sayılır) → 1/1 = 1.0
    expect(citedRetentionInSet(["m-1", "m-9"], ["m-1", "m-2"], ctxWith(["m-1", "m-2"]))).toBe(1);
  });
});

describe("scoreAnswer — temellendirme", () => {
  test("UYDURMA atıf gerçek atıftan KESİNLİKLE düşük puan alır", () => {
    const gercek = scoreAnswer("brain sqlite-vec kullanir [mem:m-1] ve vektor arar [mem:m-2]", SOURCES);
    const uydurma = scoreAnswer("brain sqlite-vec kullanir [mem:zzz] ve vektor arar [mem:yyy]", SOURCES);
    expect(gercek.score).toBeGreaterThan(uydurma.score);
    expect(gercek.validCites).toBe(2);
    expect(uydurma.validCites).toBe(0);
  });

  test("abstain / boş / erişilemez → SERT 0", () => {
    expect(scoreAnswer("BİLGİ_YOK", SOURCES).score).toBe(0);
    expect(scoreAnswer("BILGI_YOK", SOURCES).score).toBe(0);
    expect(scoreAnswer("", SOURCES).score).toBe(0);
    expect(scoreAnswer("   ", SOURCES).score).toBe(0);
  });

  test("kısa-temelli cevap, uzun-temelsizden yüksek", () => {
    const kisaTemelli = scoreAnswer("brain sqlite-vec kullanir [mem:m-1] vektor arar [mem:m-2]", SOURCES);
    const uzunTemelsiz = scoreAnswer("brain ".repeat(60) + "hicbir kaynak gostermiyorum", SOURCES);
    expect(kisaTemelli.score).toBeGreaterThan(uzunTemelsiz.score);
  });

  test("puan [0,1] aralığında ve determinist", () => {
    const a = scoreAnswer("brain sqlite-vec [mem:m-1]", SOURCES);
    const b = scoreAnswer("brain sqlite-vec [mem:m-1]", SOURCES);
    expect(a.score).toEqual(b.score);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(1);
  });

  test("kaynak yoksa atıf DOĞRULANAMAZ → temellendirme kredisi verilmez", () => {
    const r = scoreAnswer("iddia [mem:m-1]", []);
    expect(r.validCites).toBe(0);
    expect(r.score).toBeLessThan(0.5);
  });

  test("aynı atıfı tekrarlamak kredi ARTIRMAZ (uzunluk etkisi sabit tutulur)", () => {
    // Dikkat: uzunluk da puana giriyor, o yüzden iki metin de aynı bandda tutulur.
    // Ölçülen tek fark atıf TEKRARI olsun.
    const dolgu = "brain sqlite-vec kullanir ve vektor aramasi yapar, gate softmax uretir";
    const iki = scoreAnswer(`${dolgu} [mem:m-1] [mem:m-2]`, SOURCES);
    const tekrar = scoreAnswer(`${dolgu} [mem:m-1] [mem:m-2] [mem:m-1] [mem:m-2]`, SOURCES);
    expect(tekrar.validCites).toBe(iki.validCites);   // tekilleştirme
    expect(tekrar.cites).toBe(iki.cites);
  });

  test("ikiden fazla FARKLI atıf getiriyi doyurur (atıf yarışı yok)", () => {
    const s3: AskSource[] = [...SOURCES, src("m-3", "ucuncu kaynak metni")];
    const iki = scoreAnswer("brain sqlite-vec kullanir vektor arar [mem:m-1] [mem:m-2]", s3);
    const uc = scoreAnswer("brain sqlite-vec kullanir vektor arar [mem:m-1] [mem:m-2] [mem:m-3]", s3);
    // citeCredit iki atıfta zaten 1.0 → üçüncü atıf ek kredi getirmemeli.
    expect(uc.score - iki.score).toBeLessThan(0.06); // kalan fark yalnız uzunluk/örtüşmeden
  });
});

describe("scoreAll — üç uzman aynı anda", () => {
  test("EXPERTS sırasında puan dizisi; erişilemez uzman 0", () => {
    const scores = scoreAll(
      [
        { expert: "ollamas", answer: "brain sqlite-vec [mem:m-1] gate softmax [mem:m-2]", available: true },
        { expert: "ecym", answer: "", available: false },
        { expert: "odysseus", answer: "temelsiz uzun cevap ".repeat(10), available: true },
      ],
      SOURCES,
    );
    expect(scores.length).toBe(3);
    expect(scores[1]).toBe(0);                       // erişilemez
    expect(scores[0]).toBeGreaterThan(scores[2]);    // temelli > temelsiz
  });

  test("hepsi başarısızsa hepsi 0 (eğitim bu turu atlayabilsin)", () => {
    const scores = scoreAll(
      [
        { expert: "ollamas", answer: "BİLGİ_YOK", available: true },
        { expert: "ecym", answer: "", available: false },
        { expert: "odysseus", answer: "", available: false },
      ],
      SOURCES,
    );
    expect(scores).toEqual([0, 0, 0]);
  });
});
