import { describe, it, expect } from "vitest";
import { renderModelfile, alignedTag, DEFAULT_ALIGN_PARAMS } from "../bin/lib/modelfile";

describe("alignedTag", () => {
  it("derives a distinct, collision-free name from the base tag", () => {
    expect(alignedTag("qwen3:8b")).toBe("qwen3-8b-ca");
    expect(alignedTag("qwen3-coder:30b")).toBe("qwen3-coder-30b-ca");
    expect(alignedTag("deepseek-r1:32b")).toBe("deepseek-r1-32b-ca");
  });
  it("never reuses the raw base tag (no impersonation/overwrite)", () => {
    const base = "qwen3:8b";
    expect(alignedTag(base)).not.toBe(base);
    expect(alignedTag(base).endsWith("-ca")).toBe(true);
  });
});

describe("renderModelfile", () => {
  it("renders FROM + SYSTEM + PARAMETER lines", () => {
    const mf = renderModelfile({ base: "qwen3:8b", system: "You are helpful." });
    expect(mf).toContain("FROM qwen3:8b");
    expect(mf).toContain('SYSTEM """You are helpful."""');
    expect(mf).toContain("PARAMETER temperature 0.3");
    expect(mf).toContain("PARAMETER num_ctx 8192");
  });
  it("emits only the params provided", () => {
    const mf = renderModelfile({ base: "m", system: "s", params: { temperature: 0 } });
    expect(mf).toContain("PARAMETER temperature 0");
    expect(mf).not.toContain("top_p");
  });
  it("rejects an empty base", () => {
    expect(() => renderModelfile({ base: "  ", system: "s" })).toThrow(/base/i);
  });
  it("rejects a SYSTEM body containing the triple-quote fence", () => {
    expect(() => renderModelfile({ base: "m", system: 'a """ b' })).toThrow(/"""/);
  });
  it("uses calibrated defaults when no params given", () => {
    const mf = renderModelfile({ base: "m", system: "s" });
    expect(mf).toContain(`PARAMETER temperature ${DEFAULT_ALIGN_PARAMS.temperature}`);
  });
});
