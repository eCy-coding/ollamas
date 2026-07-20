// Ortak-brain formülleri (~/Desktop/formüller.md) — saf matematik sözleşmeleri.
import { describe, test, expect } from "vitest";
import {
  softmax, retrievalProbabilities, l2normalize, profileVector, personalizeQuery,
  gateLogits, gateWeights, heuristicBias, mixtureSelect, expectedMixture, updateGate, EXPERTS,
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
