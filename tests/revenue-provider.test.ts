// T2-F6 — provider::model routing for the revenue audit path. parseProviderModel is the
// shared pure parser; auditServiceArgs threads --provider to scripts/audit-service.mjs
// (which already POSTs {provider, model} to the server → catalog providers just work).
import { describe, it, expect } from "vitest";
import { parseProviderModel } from "../server/provider-catalog";
import { auditServiceArgs } from "../server/revenue";

describe("parseProviderModel (pure)", () => {
  it("provider::model → both; bare tags → model only", () => {
    expect(parseProviderModel("groq::llama-3.3-70b-versatile")).toEqual({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(parseProviderModel("qwen3-coder:480b-cloud")).toEqual({ model: "qwen3-coder:480b-cloud" });
    expect(parseProviderModel("::x")).toEqual({ model: "::x" }); // malformed stays verbatim
    expect(parseProviderModel("groq::")).toEqual({ model: "groq::" });
  });
});

describe("auditServiceArgs — audit dispatch args", () => {
  it("bare model keeps the legacy arg shape (no --provider)", () => {
    expect(auditServiceArgs("/repo", "qwen3-coder:480b-cloud", 0)).toEqual([
      "scripts/audit-service.mjs", "--repo", "/repo", "--model", "qwen3-coder:480b-cloud",
    ]);
  });
  it("provider::model threads --provider with the bare model id", () => {
    expect(auditServiceArgs("/repo", "groq::llama-3.3-70b-versatile", 4)).toEqual([
      "scripts/audit-service.mjs", "--repo", "/repo", "--model", "llama-3.3-70b-versatile",
      "--provider", "groq", "--max-units", "4",
    ]);
  });
});
