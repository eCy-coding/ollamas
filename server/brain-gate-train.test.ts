// Gate CE eğitimi — kayıp gerçekten düşmeli, ağırlık gerçekten sınırlı kalmalı.
import { describe, test, expect } from "vitest";
import {
  targetDistribution, crossEntropyLoss, clipRows, trainGate, DEFAULT_TRAIN, gateTrainPolicy,
  type Gate, type OutcomeRow,
} from "./brain-gate-train";

const zeroGate = (dim: number): Gate => ({
  W: [Array(dim).fill(0), Array(dim).fill(0), Array(dim).fill(0)],
  b: [0, 0, 0],
});

const row = (q: number[], scores: number[], turn = 0): OutcomeRow => ({ at: 1_000 + turn, turn, q, scores });

/** Ayrılabilir fixture: q=[1,0] → uzman 0 iyi; q=[0,1] → uzman 1 iyi. */
const separable = (n = 20): OutcomeRow[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0 ? row([1, 0], [0.9, 0.1, 0.1], i) : row([0, 1], [0.1, 0.9, 0.1], i));

describe("gateTrainPolicy — candidate→autonomous köprüsü (aynı ölü-yol, gate kendi yolunda)", () => {
  // gate-ce-train'in KENDİ eğitim yolu vardı (turn%10) ve egzersizci fix'inden
  // AYRI olarak eski ikili mantığı taşıyordu: mode = autonomous?"live":"sandbox".
  // Yani CANDIDATE gate-ce-train hâlâ sandbox koşuyor → live birikmez → asla otonomlaşamaz
  // → gate [0,0,0]'da kalır. Bu saf fn candidate'i canlı-gölge yapar (gate'e DOKUNMADAN).
  test("sandbox → ölçüm (sandbox mod, gate'e yazma YOK)", () => {
    expect(gateTrainPolicy("sandbox")).toEqual({ mode: "sandbox", persist: false });
  });
  test("candidate → CANLI-GÖLGE (live ölç, gate'e yazma YOK — güvenilmez)", () => {
    expect(gateTrainPolicy("candidate")).toEqual({ mode: "live", persist: false });
  });
  test("autonomous → GERÇEK (live, gate'e YAZAR)", () => {
    expect(gateTrainPolicy("autonomous")).toEqual({ mode: "live", persist: true });
  });
  test("quarantined → ölçüm, asla persist etmez", () => {
    expect(gateTrainPolicy("quarantined")).toEqual({ mode: "sandbox", persist: false });
  });
});

describe("targetDistribution", () => {
  test("puanlar hedef dağılıma dönüşür, toplam 1", () => {
    const t = targetDistribution([0.9, 0.1, 0.1])!;
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(t[0]).toBeGreaterThan(t[1]);
  });

  test("HEPSİ 0 ise null — uydurma etiket üretilmez", () => {
    // Hiçbir uzman işe yarar cevap vermediyse o turdan öğrenilecek şey yoktur.
    expect(targetDistribution([0, 0, 0])).toBeNull();
    expect(targetDistribution([])).toBeNull();
  });

  test("düşük sıcaklık hedefi keskinleştirir", () => {
    const keskin = targetDistribution([0.9, 0.1, 0.1], 0.2)!;
    const duz = targetDistribution([0.9, 0.1, 0.1], 2)!;
    expect(keskin[0]).toBeGreaterThan(duz[0]);
  });
});

describe("clipRows — kaçış yapısal olarak imkânsız", () => {
  test("tavanı aşan satır YÖN KORUNARAK küçültülür", () => {
    const W = [[3, 4], [0.1, 0], [0, 0]]; // ilk satırın normu 5
    const c = clipRows(W, 1);
    const n0 = Math.hypot(...c[0]);
    expect(n0).toBeCloseTo(1, 6);
    expect(c[0][1] / c[0][0]).toBeCloseTo(4 / 3, 6); // yön aynı
    expect(c[1]).toEqual([0.1, 0]);                   // tavan altındaki dokunulmaz
  });

  test("sıfır satır çökmez", () => {
    expect(clipRows([[0, 0]], 1)).toEqual([[0, 0]]);
  });
});

describe("trainGate", () => {
  test("ayrılabilir veride kayıp DÜŞER ve doğru uzmanı öğrenir", () => {
    const rows = separable(20);
    const { gate, losses } = trainGate(zeroGate(2), rows, { epochs: 60, lr: 0.5 });
    expect(losses.length).toBe(60);
    expect(losses.at(-1)!).toBeLessThan(losses[0]); // ÖĞRENDİ

    // q=[1,0] → uzman 0 en yüksek logit almalı
    const logit = (q: number[]) => gate.W.map((r, j) => r.reduce((a, w, i) => a + w * q[i], 0) + gate.b[j]);
    const l0 = logit([1, 0]);
    expect(l0.indexOf(Math.max(...l0))).toBe(0);
    const l1 = logit([0, 1]);
    expect(l1.indexOf(Math.max(...l1))).toBe(1);
  });

  test("hiçbir satır L2 tavanını AŞAMAZ (çöküş bir daha olamaz)", () => {
    // Tek uzmanı 500 kez ödüllendir — eski perceptron burada sınırsız büyüyordu.
    const rows = Array.from({ length: 50 }, (_, i) => row([1, 0], [1, 0, 0], i));
    const { gate } = trainGate(zeroGate(2), rows, { epochs: 500, lr: 0.9, l2Cap: 0.5 });
    for (const r of gate.W) expect(Math.hypot(...r)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  test("boş/kullanılamaz veri → gate DEĞİŞMEZ", () => {
    const init = zeroGate(2);
    expect(trainGate(init, []).losses).toEqual([]);
    // hepsi-0 puanlı satırlar da kullanılamaz
    const { gate, losses } = trainGate(init, [row([1, 0], [0, 0, 0])]);
    expect(losses).toEqual([]);
    expect(gate).toEqual(init);
  });

  test("girdi gate MUTASYONA UĞRAMAZ", () => {
    const init = zeroGate(2);
    const snapshot = JSON.stringify(init);
    trainGate(init, separable(10), { epochs: 20 });
    expect(JSON.stringify(init)).toBe(snapshot);
  });

  test("çökmüş bir gate dengeye ÇEKİLİR", () => {
    // Kusur G'nin canlı imzası: bir uzmanın satırı diğerlerinin ~2 katı.
    const collapsed: Gate = { W: [[0.1, 0.1], [0.1, 0.1], [0.6, 0.6]], b: [-0.04, -0.04, 0.08] };
    const before = Math.hypot(...collapsed.W[2]);
    // Kanıt uzman 0 ve 1'i destekliyor:
    const rows = separable(20);
    const { gate } = trainGate(collapsed, rows, { epochs: 100, lr: 0.5 });
    const after = Math.hypot(...gate.W[2]);
    expect(after).toBeLessThan(before); // baskın uzman geriler
    const l0 = gate.W.map((r, j) => r[0] * 1 + r[1] * 0 + gate.b[j]);
    expect(l0.indexOf(Math.max(...l0))).toBe(0); // kanıt kimi gösteriyorsa o kazanır
  });

  test("GERÇEK ÖLÇEKTE ıraksamaz (|q|≈20, canlı nomic vektörleri)", () => {
    // 2026-07-20 CANLI HATA: birim testler |q|=1 ile koşuyordu, ama canlı nomic
    // vektörleri ham saklanıyor ve |q|≈19-20. Gradyan |q|² ile ölçeklendiği için
    // efektif lr ~400 kat büyüdü ve kayıp ARTTI (sandbox metriği -0.598 yakaladı).
    // Bu test o ölçeği taklit eder: eğitim yönü normalize edip kararlı kalmalı.
    const scale = 20 / Math.sqrt(2);
    const rows: OutcomeRow[] = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? row([scale, 0], [0.9, 0.1, 0.1], i)
        : row([0, scale], [0.1, 0.9, 0.1], i));
    const { losses } = trainGate(zeroGate(2), rows, { epochs: 40 });
    expect(losses.length).toBeGreaterThan(0);
    expect(losses.at(-1)!).toBeLessThan(losses[0]); // ıraksama YOK, öğreniyor
    expect(Number.isFinite(losses.at(-1)!)).toBe(true);
  });

  test("CANLI KOŞUL: az satır + 768 boyut + |q|≈20 ⇒ yine de ıraksamaz", () => {
    // Canlı ıraksamanın gerçek tetiği |q|²/m: 4 satır × |q|²=400 → 100 (fixture'da 10).
    // Yani "az veri + büyük vektör" birleşimi. İlk eğitim turu TAM BÖYLE koşuyor.
    const dim = 768;
    const unit = (k: number) => {
      const v = Array(dim).fill(0);
      for (let i = 0; i < dim; i++) v[i] = Math.sin(i * (k + 1)) ;
      const n = Math.hypot(...v);
      return v.map((x) => (x / n) * 20); // |q| = 20, canlı nomic ölçeği
    };
    const rows: OutcomeRow[] = [
      { at: 1, turn: 77, q: unit(0), scores: [0, 0.7333, 0.15] },
      { at: 2, turn: 78, q: unit(1), scores: [0.76, 0.76, 0.18] },
      { at: 3, turn: 79, q: unit(2), scores: [0.9231, 0.7429, 0.3] },
      { at: 4, turn: 80, q: unit(3), scores: [0, 0.7434, 0.15] },
    ];
    const { losses, gate } = trainGate(zeroGate(dim), rows);
    expect(losses.length).toBeGreaterThan(0);
    expect(losses.every((l) => Number.isFinite(l))).toBe(true);
    // ASIL İDDİA: kayıp DÜŞMELİ. Düzeltmeden önce burada -0.598 artış vardı.
    expect(losses.at(-1)!).toBeLessThanOrEqual(losses[0]);
    for (const r of gate.W) expect(Math.hypot(...r)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  test("ÖLÇEK-DEĞİŞMEZ: |q| ne olursa olsun AYNI kayıp eğrisi (ıraksama korumasının kendisi)", () => {
    // Bu, ıraksamayı yapısal olarak imkânsız kılan özelliktir. Normalizasyon
    // kaldırılırsa bu test derhal düşer — asıl regresyon bekçisi budur.
    const mk = (s: number) => Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? row([s, 0], [0.9, 0.1, 0.1], i) : row([0, s], [0.1, 0.9, 0.1], i));
    const a = trainGate(zeroGate(2), mk(1), { epochs: 30 }).losses;
    const b = trainGate(zeroGate(2), mk(25), { epochs: 30 }).losses;
    expect(a.length).toBe(b.length);
    a.forEach((l, i) => expect(l).toBeCloseTo(b[i], 9));
  });

  test("YÜKSEK KORELASYONLU büyük vektörler (canlı hatanın gerçek tetiği) ıraksamaz", () => {
    // Canlı q'lar aynı dilde benzer sorulardır → kosinüs ~0.8+. Sentetik dik
    // vektörler bu hatayı ÜRETEMEDİ; gerçek defterle üretildi (1.099 → 4.312).
    // Burada o koşul taklit edilir: ortak taban + küçük gürültü, |q|=20, az satır.
    const dim = 64;
    const base = Array.from({ length: dim }, (_, i) => Math.sin(i));
    const near = (k: number) => {
      const v = base.map((x, i) => x + 0.15 * Math.sin(i * 7 + k * 3));
      const n = Math.hypot(...v);
      return v.map((x) => (x / n) * 20);
    };
    const rows: OutcomeRow[] = [
      { at: 1, turn: 1, q: near(0), scores: [0, 0.7333, 0.15] },
      { at: 2, turn: 2, q: near(1), scores: [0.76, 0.76, 0.18] },
      { at: 3, turn: 3, q: near(2), scores: [0.9231, 0.7429, 0.3] },
      { at: 4, turn: 4, q: near(3), scores: [0, 0.7434, 0.15] },
    ];
    const { losses, gate } = trainGate(zeroGate(dim), rows);
    expect(losses.every((l) => Number.isFinite(l))).toBe(true);
    expect(losses.at(-1)!).toBeLessThan(losses[0]);            // öğreniyor, salınmıyor
    for (const r of gate.W) expect(Math.hypot(...r)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  test("varsayılan seçenekler makul", () => {
    expect(DEFAULT_TRAIN.l2Cap).toBeGreaterThan(0);
    expect(DEFAULT_TRAIN.epochs).toBeGreaterThan(0);
  });
});

describe("crossEntropyLoss", () => {
  test("doğru yönde eğitilmiş gate daha düşük kayıp verir", () => {
    const rows = separable(10);
    const zero = crossEntropyLoss(zeroGate(2), rows);
    const { gate } = trainGate(zeroGate(2), rows, { epochs: 80, lr: 0.5 });
    expect(crossEntropyLoss(gate, rows)).toBeLessThan(zero);
  });

  test("kullanılabilir satır yoksa 0", () => {
    expect(crossEntropyLoss(zeroGate(2), [])).toBe(0);
  });
});
