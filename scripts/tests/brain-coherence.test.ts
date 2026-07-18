import { describe, it, expect } from "vitest";
import { cosine, maxAnchorBond, verdict } from "../brain-coherence-audit";

describe("brain-coherence-audit (pure)", () => {
  it("cosine + max-anchor bond", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 5);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
    expect(maxAnchorBond([1, 0], [[0, 1], [0.8, 0.6]])).toBeCloseTo(0.8, 5);
  });
  it("verdict: quarantine only low-bond AND zero-hit; used or bonded records stay", () => {
    expect(verdict(0.2, 0)).toBe("quarantine");
    expect(verdict(0.2, 3)).toBe("keep"); // earned recalls → immune
    expect(verdict(0.6, 0)).toBe("keep");
  });
});
