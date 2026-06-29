import { describe, it, expect } from "vitest";
import { checkAnswer, scoreCouncil, type CouncilResult } from "../server/council";

describe("checkAnswer", () => {
  it("matches answer inside a <think> wrapper and plain text", () => {
    expect(checkAnswer("<think>let me compute 2+2</think> The answer is 4", "4")).toBe(true);
    expect(checkAnswer("The result is 42 exactly", "42")).toBe(true);
  });

  it("ignores answers that only appear inside the stripped <think> block", () => {
    expect(checkAnswer("<think>maybe 7</think> I am not sure", "7")).toBe(false);
  });

  it("strips code fences but keeps inner content", () => {
    expect(checkAnswer("```js\nconst x = 99;\n```", "99")).toBe(true);
  });

  it("matches '-1' standalone but NOT inside '31'", () => {
    expect(checkAnswer("the value is -1 here", "-1")).toBe(true);
    expect(checkAnswer("the value is 31 here", "-1")).toBe(false);
  });

  it("rejects null and empty inputs", () => {
    expect(checkAnswer(null as any, "4")).toBe(false);
    expect(checkAnswer("answer 4", null as any)).toBe(false);
    expect(checkAnswer("answer 4", "")).toBe(false);
    expect(checkAnswer("answer 4", "   ")).toBe(false);
  });
});

describe("scoreCouncil", () => {
  it("computes perModel rates and sorts descending; singleBest is top", () => {
    const results: CouncilResult[] = [
      { model: "a", taskId: "t1", correct: true },
      { model: "a", taskId: "t2", correct: true },
      { model: "b", taskId: "t1", correct: true },
      { model: "b", taskId: "t2", correct: false },
    ];
    const s = scoreCouncil(results);
    expect(s.perModel[0].model).toBe("a");
    expect(s.perModel[0].rate).toBe(1);
    expect(s.perModel[1].rate).toBe(0.5);
    expect(s.singleBest).toEqual({ model: "a", rate: 1 });
  });

  it("counts bestOfN (any-correct) and majority (>= half) per task", () => {
    const results: CouncilResult[] = [
      // t1: a correct, b wrong, c wrong -> any yes, majority no (1/3)
      { model: "a", taskId: "t1", correct: true },
      { model: "b", taskId: "t1", correct: false },
      { model: "c", taskId: "t1", correct: false },
      // t2: a correct, b correct, c wrong -> any yes, majority yes (2/3)
      { model: "a", taskId: "t2", correct: true },
      { model: "b", taskId: "t2", correct: true },
      { model: "c", taskId: "t2", correct: false },
    ];
    const s = scoreCouncil(results);
    expect(s.bestOfN).toBe(1);       // both tasks have someone correct
    expect(s.majority).toBe(0.5);    // only t2 reaches majority
  });

  it("recommends 'single' when a single model is 100% (ties best-of-N)", () => {
    const results: CouncilResult[] = [
      { model: "a", taskId: "t1", correct: true },
      { model: "a", taskId: "t2", correct: true },
      { model: "b", taskId: "t1", correct: false },
      { model: "b", taskId: "t2", correct: true },
    ];
    const s = scoreCouncil(results);
    expect(s.singleBest?.rate).toBe(1);
    expect(s.bestOfN).toBe(1);
    expect(s.recommended.policy).toBe("single");
  });

  it("recommends 'best-of-n' when no single model is 100% but the union is", () => {
    // 3 models, each task solved by exactly ONE model -> union perfect (best-of-n=1),
    // but no single model perfect AND majority never reached (1/3 < half).
    const results: CouncilResult[] = [
      { model: "a", taskId: "t1", correct: true },
      { model: "b", taskId: "t1", correct: false },
      { model: "c", taskId: "t1", correct: false },
      { model: "a", taskId: "t2", correct: false },
      { model: "b", taskId: "t2", correct: true },
      { model: "c", taskId: "t2", correct: false },
      { model: "a", taskId: "t3", correct: false },
      { model: "b", taskId: "t3", correct: false },
      { model: "c", taskId: "t3", correct: true },
    ];
    const s = scoreCouncil(results);
    expect(s.singleBest?.rate).toBeLessThan(1);
    expect(s.bestOfN).toBe(1);
    expect(s.majority).toBeLessThan(1);
    expect(s.recommended.policy).toBe("best-of-n");
  });

  it("handles empty input without throwing", () => {
    const s = scoreCouncil([]);
    expect(s.perModel).toEqual([]);
    expect(s.singleBest).toBeNull();
    expect(s.bestOfN).toBe(0);
    expect(s.majority).toBe(0);
    expect(s.recommended.policy).toBe("single");
  });
});
