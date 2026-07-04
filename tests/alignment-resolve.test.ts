// vO65 — the runtime resolver that substitutes a local model tag with its Constitutional-Alignment "-ca"
// variant. Env-gated + regression-clean-gated + variant-existence-gated → default-OFF is a pure pass-through
// (never changes behaviour), and even ON it only substitutes a variant that passed the conformance regression
// check AND is actually present in ollama.
import { describe, it, expect } from "vitest";
import { parseAlignmentSelection, resolveAlignedModel, alignmentEnabled } from "../server/alignment";

const SEL_JSON = {
  selection: { model: "qwen3-8b-ca" },
  variants: [
    { base: "qwen3:8b", aligned: "qwen3-8b-ca", regression: { ok: true } },
    { base: "gpt-oss:20b", aligned: "gpt-oss-20b-ca", regression: { ok: false } }, // failed → never mapped
    { base: "phi4:latest", aligned: "phi4-latest-ca", regression: { ok: false } },
  ],
};

describe("parseAlignmentSelection", () => {
  it("maps ONLY regression-clean variants (base → aligned)", () => {
    const sel = parseAlignmentSelection(SEL_JSON);
    expect(sel.map).toEqual({ "qwen3:8b": "qwen3-8b-ca" });
    expect(sel.map["gpt-oss:20b"]).toBeUndefined(); // reg-fail excluded
  });
  it("empty / malformed input → empty map (graceful)", () => {
    expect(parseAlignmentSelection(null).map).toEqual({});
    expect(parseAlignmentSelection({}).map).toEqual({});
    expect(parseAlignmentSelection({ variants: "nope" }).map).toEqual({});
  });
});

describe("alignmentEnabled", () => {
  it("truthy OLLAMAS_ALIGN enables; absent/0/false disables", () => {
    expect(alignmentEnabled({ OLLAMAS_ALIGN: "1" })).toBe(true);
    expect(alignmentEnabled({ OLLAMAS_ALIGN: "true" })).toBe(true);
    expect(alignmentEnabled({ OLLAMAS_ALIGN: "0" })).toBe(false);
    expect(alignmentEnabled({ OLLAMAS_ALIGN: "false" })).toBe(false);
    expect(alignmentEnabled({})).toBe(false);
  });
});

describe("resolveAlignedModel", () => {
  const sel = parseAlignmentSelection(SEL_JSON);
  it("disabled → pass-through (default-OFF never changes the model)", () => {
    expect(resolveAlignedModel("qwen3:8b", sel, { enabled: false })).toBe("qwen3:8b");
  });
  it("enabled + reg-clean + no `have` → substitutes the aligned variant", () => {
    expect(resolveAlignedModel("qwen3:8b", sel, { enabled: true })).toBe("qwen3-8b-ca");
  });
  it("enabled + reg-FAILED base → pass-through (bad variant never used)", () => {
    expect(resolveAlignedModel("gpt-oss:20b", sel, { enabled: true })).toBe("gpt-oss:20b");
  });
  it("enabled + unknown model → itself", () => {
    expect(resolveAlignedModel("llama3.3:70b", sel, { enabled: true })).toBe("llama3.3:70b");
  });
  it("enabled but the variant is NOT present in ollama (`have`) → base (never dispatch a missing tag)", () => {
    expect(resolveAlignedModel("qwen3:8b", sel, { enabled: true, have: new Set(["qwen3:8b"]) })).toBe("qwen3:8b");
    expect(resolveAlignedModel("qwen3:8b", sel, { enabled: true, have: new Set(["qwen3:8b", "qwen3-8b-ca:latest"]) })).toBe("qwen3-8b-ca"); // :latest suffix tolerated
    expect(resolveAlignedModel("qwen3:8b", sel, { enabled: true, have: new Set(["qwen3:8b", "qwen3-8b-ca"]) })).toBe("qwen3-8b-ca");
  });
  it("empty selection map → always pass-through even when enabled", () => {
    const empty = parseAlignmentSelection({});
    expect(resolveAlignedModel("qwen3:8b", empty, { enabled: true })).toBe("qwen3:8b");
  });
});
