// F7 logprob yakalama + p_final karışımı — odysseus DIŞLANIR, coverage dürüst.
import { describe, test, expect } from "vitest";
import { extractTokenLogprobs } from "./brain-logprob";
import { sequenceLogprob, perTokenMixture } from "./brain-formulas";

const openaiResp = (lps: number[]) => ({
  choices: [{ logprobs: { content: lps.map((lp, i) => ({ token: `t${i}`, logprob: lp })) } }],
});

describe("extractTokenLogprobs", () => {
  test("OpenAI biçiminden token logprob'larını çıkarır", () => {
    expect(extractTokenLogprobs(openaiResp([-0.5, -1.2, -0.1]))).toEqual([-0.5, -1.2, -0.1]);
  });
  test("logprobs alanı yoksa / bozuksa boş (çökmez)", () => {
    expect(extractTokenLogprobs({ choices: [{}] })).toEqual([]);
    expect(extractTokenLogprobs(null)).toEqual([]);
    expect(extractTokenLogprobs({})).toEqual([]);
  });
  test("NaN/sonsuz logprob elenir", () => {
    expect(extractTokenLogprobs(openaiResp([-0.5, NaN, -0.3]))).toEqual([-0.5, -0.3]);
  });
});

describe("F7 p_final entegrasyonu — logprob VERMEYEN uzman DIŞLANIR", () => {
  test("yalnız ollamas logprob verir → coverage = w[ollamas], odysseus/ecym null→dışlanır", () => {
    // ollamas avg logprob hesaplanır; ecym/odysseus ÖLÇÜLEMEDİ (null).
    const ollamasAvg = sequenceLogprob(extractTokenLogprobs(openaiResp([-0.2, -0.4])));
    const w = [0.5, 0.3, 0.2]; // ollamas, ecym, odysseus (EXPERTS sırası)
    const r = perTokenMixture([ollamasAvg, null, null], w);
    expect(r.covered).toEqual([true, false, false]);
    expect(r.coverage).toBe(0.5);          // yalnız ollamas'ın w'si
    expect(r.pFinal).not.toBeNull();       // en az bir uzman ölçülebildi
  });
  test("HİÇ uzman logprob vermezse pFinal null (uydurma sayı YOK)", () => {
    const r = perTokenMixture([null, null, null], [0.5, 0.3, 0.2]);
    expect(r.pFinal).toBeNull();
    expect(r.coverage).toBe(0);
  });
  test("odysseus SIFIR sayılmaz — dışlanınca kalan uzmanların p_final'i düşmez", () => {
    // odysseus'u 0 saysaydik pFinal yapay düşerdi; DIŞLAMA doğru davranış.
    const withExcluded = perTokenMixture([-0.2, null], [0.7, 0.3]);
    const asZero = 0.7 * Math.exp(-0.2) + 0.3 * Math.exp(0); // yanlış hesap (0 sayma)
    expect(withExcluded.pFinal).toBeCloseTo(0.7 * Math.exp(-0.2), 6);
    expect(withExcluded.pFinal).not.toBeCloseTo(asZero, 6);
  });
});
