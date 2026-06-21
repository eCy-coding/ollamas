import { describe, it, expect } from "vitest";
import { isModelQuestion } from "../bin/model-hook";

describe("isModelQuestion — model-seçim sorusu tespiti (0-manuel auto-inject)", () => {
  it("model-seçim sorularını yakalar (TR+EN)", () => {
    for (const q of [
      "hangi model en verimli?",
      "en verimli model hangisi",
      "optimal model nedir",
      "which model is best for coding",
      "best model right now?",
      "kaç tok/s alıyoruz",
    ]) expect(isModelQuestion(q)).toBe(true);
  });
  it("alakasız prompt → false (sessiz exit, token israfı yok)", () => {
    for (const q of ["merhaba", "bu testi düzelt", "git log göster", ""]) {
      expect(isModelQuestion(q)).toBe(false);
    }
  });
});
