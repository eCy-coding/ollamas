import { describe, it, expect } from "vitest";
import { scoreRun } from "../../bin/host-bridge/bench-metrics.mjs";

// v1.25.1 bench honesty: a bridge/terminal failure = "could not measure", which must
// be recorded as correct/ran = null (unknown), NEVER false ("wrong answer").
describe("scoreRun — bridge/terminal fail = ölçülemedi (correct:null, false DEĞİL)", () => {
  const EXPECTED = "2 3 5 7 11 13 17 19 23 29";

  it("bridgeError → correct:null + ran:null (unmeasured ≠ wrong)", () => {
    const s = scoreRun({ bridgeError: true, status: "HTTP 502" }, EXPECTED);
    expect(s.correct).toBeNull();
    expect(s.ran).toBeNull();
    expect(s.bridgeError).toBe("HTTP 502");
  });

  it("bridgeError status yoksa true'ya düşer (yine de null correctness)", () => {
    const s = scoreRun({ bridgeError: true }, EXPECTED);
    expect(s.correct).toBeNull();
    expect(s.bridgeError).toBe(true);
  });

  it("doğru çıktı → correct:true, ran:true", () => {
    const s = scoreRun({ exitCode: 0, output: EXPECTED + "\n" }, EXPECTED);
    expect(s.correct).toBe(true);
    expect(s.ran).toBe(true);
  });

  it("yanlış çıktı ama koştu → correct:false, ran:true (gerçek başarısızlık)", () => {
    const s = scoreRun({ exitCode: 0, output: "nope" }, EXPECTED);
    expect(s.correct).toBe(false);
    expect(s.ran).toBe(true);
  });

  it("non-zero exit → ran:false, correct:false", () => {
    const s = scoreRun({ exitCode: 1, output: "" }, EXPECTED);
    expect(s.ran).toBe(false);
    expect(s.correct).toBe(false);
  });
});
