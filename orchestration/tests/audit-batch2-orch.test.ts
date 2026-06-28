import { describe, it, expect } from "vitest";
import { auditDuplication } from "../bin/lib/critic";
import { optimalConfig } from "../bin/lib/optimize";

// O3: the inner `b` keyword list must be deduped like `a` (a Set). Pre-fix a
// repeated shared keyword inflated the overlap count → false duplication flag.
describe("critic auditDuplication dedupe (O3)", () => {
  it("a repeated shared keyword does not create a false duplication", () => {
    const tools = [
      { name: "t1", purpose: "alpha beta" },
      { name: "t2", purpose: "alpha alpha gamma" }, // 'alpha' repeated
    ];
    // distinct overlap = {alpha} = 1 → below the 2-keyword threshold → no dup.
    // (Pre-fix the repeat counted 'alpha' twice → overlap 2 → false positive.)
    expect(auditDuplication(tools).length).toBe(0);
  });
});

// O4: the `num_ctx > 8192` cap was dead code (max is 8192) and its intent does not
// apply to Apple-Silicon unified memory. Removed → big models that fit RAM keep full
// ctx; the RAM tiers stay authoritative.
describe("optimalConfig (O4 dead-branch removed)", () => {
  it("does not spuriously cap a big model that fits in high RAM", () => {
    expect(optimalConfig(48, 16, "qwen3-coder:30b").num_ctx).toBe(8192); // ~19.5GB, fits → full
    expect(optimalConfig(48, 16, "llama3.3:70b").num_ctx).toBe(8192); // big, high RAM → full
    expect(optimalConfig(8, 8, "qwen3:8b").num_ctx).toBe(2048); // low-RAM tier still low
  });
});
