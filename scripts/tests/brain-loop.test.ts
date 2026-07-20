import { describe, it, expect } from "vitest";
import { questionFromRecord, shouldAsk, type LoopState } from "../brain-loop";

const state = (over: Partial<LoopState> = {}): LoopState =>
  ({ turn: 1, day: "2026-07-20", writesToday: 0, askedHashes: [], lastAt: 0, ...over });

describe("brain-loop (pure)", () => {
  it("derives a learning question from a record, quoted subject preferred", () => {
    expect(questionFromRecord("ollamas kod-deseni 'guarded-alter': şema evrimi ALTER ile.")).toBe(
      "guarded-alter nedir, ollamas'ta nasıl kullanılır?",
    );
    expect(questionFromRecord("Brain servisi recall-hybrid vektör+BM25 fusion yapar")).toContain("özetle");
  });
  it("budget and repeat guards", () => {
    expect(shouldAsk(state(), "abc", 40)).toBe(true);
    expect(shouldAsk(state({ writesToday: 40 }), "abc", 40)).toBe(false); // günlük bütçe doldu
    expect(shouldAsk(state({ askedHashes: ["abc"] }), "abc", 40)).toBe(false); // tekrar sorma
  });
});
