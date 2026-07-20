// Ortak-brain formülleri (~/Desktop/formüller.md) — saf matematik sözleşmeleri.
import { describe, test, expect } from "vitest";
import {
  softmax, retrievalProbabilities, l2normalize, profileVector, personalizeQuery,
  gateLogits, gateWeights, heuristicBias, mixtureSelect, expectedMixture, updateGate, EXPERTS,
  sequenceWeights, weightedContext, avgMaxScore, sequenceLogprob, perTokenMixture,
} from "./brain-formulas";

describe("Formül 2 — p_ret(z|x) = softmax(qᵀd)", () => {
  test("probabilities sum to 1, order preserved, temperature sharpens/flattens", () => {
    const p = retrievalProbabilities([2, 1, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[0]).toBeGreaterThan(p[1]);
    const sharp = retrievalProbabilities([2, 1, 0], 0.5);
    const flat = retrievalProbabilities([2, 1, 0], 5);
    expect(sharp[0]).toBeGreaterThan(p[0]); // düşük T → keskinleşir
    expect(flat[0]).toBeLessThan(p[0]);     // yüksek T → düzleşir
    expect(softmax([]).length).toBe(0);
  });
});

describe("Formül 3c — q* = q + λ·p_u (kişiselleştirme)", () => {
  test("profile vector is the L2-normalized mean; λ scales its pull", () => {
    const pu = profileVector([[2, 0], [0, 2]]);
    expect(Math.hypot(...pu)).toBeCloseTo(1, 6);
    const q = [1, 0];
    expect(personalizeQuery(q, pu, 0)).toEqual(q); // λ=0 → kişiselleştirme yok
    const qs = personalizeQuery(q, [0, 1], 0.5);
    expect(qs[1]).toBeCloseTo(0.5, 6);
    expect(l2normalize([0, 0])).toEqual([0, 0]); // sıfır vektör güvenli
  });
});

describe("Formül 3b — w_j(x) = softmax(W_g q + b_g) (MoE gate)", () => {
  test("weights sum to 1; heuristic bias steers cold-start; online update moves the chosen expert up", () => {
    const d = 4;
    const W = [Array(d).fill(0), Array(d).fill(0), Array(d).fill(0)];
    const b = [0, 0, 0];
    const q = [1, 0, 0, 0];
    const w0 = gateWeights(gateLogits(q, W, b));
    expect(w0.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
    expect(w0[0]).toBeCloseTo(1 / 3, 6); // soğuk başlangıç = uniform
    expect(heuristicBias("bu kodda hangi modül import ediyor")[EXPERTS.indexOf("ollamas")]).toBeGreaterThan(0);
    expect(heuristicBias("terminalde disk doluluğunu göster")[EXPERTS.indexOf("ecym")]).toBeGreaterThan(0);
    const { W: W2, b: b2 } = updateGate(W, b, q, 1, 0.5);
    const w1 = gateWeights(gateLogits(q, W2, b2));
    expect(w1[1]).toBeGreaterThan(w0[1]); // seçilen uzmanın ağırlığı arttı
    expect(w1.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
  });
});

describe("Formül 3b/son — p_final = Σ_j w_j p_j", () => {
  test("expectedMixture is the weighted sum; mixtureSelect picks by weight and renormalizes over available experts", () => {
    expect(expectedMixture([0.2, 0.8], [0.25, 0.75])).toBeCloseTo(0.2 * 0.25 + 0.8 * 0.75, 6);
    const chosen = mixtureSelect(
      [{ expert: "ollamas", answer: "A", available: true }, { expert: "ecym", answer: "B", available: false }, { expert: "odysseus", answer: "C", available: true }],
      [0.2, 0.7, 0.1],
    );
    expect(chosen.expert).toBe("ollamas"); // ecym yok → kalanlar renormalize, en yüksek ollamas
    expect(chosen.weights.ecym).toBe(0);
    expect(chosen.weights.ollamas + chosen.weights.odysseus).toBeCloseTo(1, 6);
    expect(chosen.degraded).toContain("ecym");
  });
});

// Formül 3a (RAG-Sequence): p_RAG-Seq(y|x) = Σ_z p_ret(z|x)·p_gen(y|x,z)
// Çalışan biçim: p_ret kaynak SIRALAMASINI ve bağlam BÜTÇE PAYINI belirler —
// yüksek olasılıklı belge daha çok yer alır. Logprob gerektirmez.
describe("Formül 3a — RAG-Sequence bağlam ağırlıklandırma", () => {
  const src = (id: string, excerpt: string, score: number) =>
    ({ id, tier: "learned", score, excerpt }) as any;

  test("sequenceWeights = p_ret: toplam 1, skor sırasını korur", () => {
    const p = sequenceWeights([3, 1, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[2]);
  });

  test("tüm skorlar eşitse dağılım UNIFORM (kayırma yok)", () => {
    const p = sequenceWeights([2, 2, 2]);
    expect(p[0]).toBeCloseTo(1 / 3, 6);
    expect(p[1]).toBeCloseTo(1 / 3, 6);
  });

  test("weightedContext: yüksek p_ret'li kaynak ÖNCE ve daha UZUN yer alır", () => {
    const sources = [
      src("m-low", "d".repeat(400), 0.1),
      src("m-high", "y".repeat(400), 3.0),
    ];
    const p = sequenceWeights(sources.map((s) => s.score));
    const ctx = weightedContext(sources, p, 300);
    expect(ctx.indexOf("m-high")).toBeLessThan(ctx.indexOf("m-low")); // sıralama
    const yCount = (ctx.match(/y/g) || []).length;
    const dCount = (ctx.match(/d/g) || []).length;
    expect(yCount).toBeGreaterThan(dCount); // bütçe payı p_z ile orantılı
  });

  test("weightedContext bütçeyi AŞMAZ", () => {
    const sources = Array.from({ length: 5 }, (_, i) => src(`m-${i}`, "x".repeat(500), 1));
    const ctx = weightedContext(sources, sequenceWeights(sources.map(() => 1)), 400);
    expect(ctx.length).toBeLessThanOrEqual(400 * 1.35); // id/etiket payı için tolerans
  });

  test("boş kaynak listesi çökmez", () => {
    expect(weightedContext([], [], 100)).toBe("");
    expect(sequenceWeights([])).toEqual([]);
  });

  test("her kaynak en az bir parça alır (tamamen susturulmaz)", () => {
    const sources = [src("m-a", "a".repeat(300), 10), src("m-b", "b".repeat(300), 0.001)];
    const ctx = weightedContext(sources, sequenceWeights(sources.map((s) => s.score)), 200);
    expect(ctx).toContain("m-b"); // düşük olasılıklı kaynak da görünür kalır
  });
});

// Formül 4 (ReAtt): r_h(q,d) = avg_{t∈q}( max_{s∈d} A^{q,d}[t,s] )
describe("Formül 4 — ReAtt avg-max skoru", () => {
  const e1 = [1, 0, 0], e2 = [0, 1, 0], e3 = [0, 0, 1];

  test("aynı parçalar tam eşleşir (skor 1)", () => {
    expect(avgMaxScore([e1, e2], [e1, e2])).toBeCloseTo(1, 6);
  });

  test("dik parçalar eşleşmez (skor 0)", () => {
    expect(avgMaxScore([e1], [e2, e3])).toBeCloseTo(0, 6);
  });

  test("MAX alınır: bir tek iyi eşleşme yeterli, kötüler cezalandırmaz", () => {
    // q parçası e1; d'de bir tane e1 var, gerisi alakasız → max = 1
    expect(avgMaxScore([e1], [e3, e2, e1])).toBeCloseTo(1, 6);
  });

  test("AVG alınır: sorgu parçalarının ortalaması", () => {
    // e1 tam eşleşir (1), e2 hiç eşleşmez (0) → ortalama 0.5
    expect(avgMaxScore([e1, e2], [e1, e3])).toBeCloseTo(0.5, 6);
  });

  test("büyüklükten bağımsız (kosinüs — ölçek değil YÖN)", () => {
    expect(avgMaxScore([[5, 0, 0]], [[0.2, 0, 0]])).toBeCloseTo(1, 6);
  });

  test("boş girdi 0 döner, çökmez", () => {
    expect(avgMaxScore([], [e1])).toBe(0);
    expect(avgMaxScore([e1], [])).toBe(0);
    expect(avgMaxScore([[0, 0, 0]], [[0, 0, 0]])).toBe(0); // sıfır vektör güvenli
  });

  test("daha ilgili doküman daha yüksek skor alır (sıralama amacı)", () => {
    const q = [e1, e2];
    const ilgili = [e1, e2, e3];
    const alakasiz = [e3, e3];
    expect(avgMaxScore(q, ilgili)).toBeGreaterThan(avgMaxScore(q, alakasiz));
  });
});

// Formül 3a/3b (RAG-Token): p_final(y|x) = Σ_j w_j(x) · p_j(y|x)
// Faz-0 ÖLÇÜMÜ: ollama 0.32.1 /v1/chat/completions per-token logprob VERİYOR,
// /api/chat vermiyor. Yani gerçek p_final artık hesaplanabilir — ama YALNIZ
// logprob dönen uzmanlar için (odysseus MCP üzerinden geldiği için veremez).
describe("Formül 3a/3b — gerçek p_final (logprob)", () => {
  test("dizi logprob'u ortalama token logprob'una çevrilir (uzunluk yanlılığı yok)", () => {
    // Uzun cevap doğal olarak daha düşük TOPLAM logprob alır; ortalama almazsak
    // mixture kısa cevabı sistematik olarak kayırırdı.
    expect(sequenceLogprob([-0.1, -0.1, -0.1])).toBeCloseTo(-0.1, 6);
    expect(sequenceLogprob([-0.1, -0.1, -0.1, -0.1, -0.1])).toBeCloseTo(-0.1, 6);
    expect(sequenceLogprob([])).toBeNull(); // veri yok → iddia yok
  });

  test("perTokenMixture: logprob veren uzmanlar w_j ile karıştırılır", () => {
    // p_j = exp(ort. logprob); p_final = Σ_j w_j p_j
    const r = perTokenMixture([-0.1, null, -2.0], [0.5, 0.3, 0.2]);
    expect(r.pFinal).toBeCloseTo(0.5 * Math.exp(-0.1) + 0.2 * Math.exp(-2.0), 6);
    // Logprob VERMEYEN uzman (null) toplamdan DIŞLANIR ve dürüstçe raporlanır.
    expect(r.covered).toEqual([true, false, true]);
    expect(r.coverage).toBeCloseTo(0.7, 6); // w kapsaması: 0.5+0.2
  });

  test("hiç logprob yoksa null — uydurma p_final üretilmez", () => {
    const r = perTokenMixture([null, null, null], [0.5, 0.3, 0.2]);
    expect(r.pFinal).toBeNull();
    expect(r.coverage).toBe(0);
  });

  test("daha olası cevap daha yüksek p_final verir", () => {
    const iyi = perTokenMixture([-0.05, null, null], [1, 0, 0]).pFinal!;
    const kotu = perTokenMixture([-3.0, null, null], [1, 0, 0]).pFinal!;
    expect(iyi).toBeGreaterThan(kotu);
  });
});
