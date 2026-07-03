import { describe, it, expect } from "vitest";
import { apiVendorCandidates, isActionableProposal, extractProposalText } from "../bin/lib/vendor-propose";
import type { StreamSpec } from "../bin/lib/fleet-plan";

const SR = "## Change: x\n<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE\nVERDICT: DONE.";

describe("apiVendorCandidates", () => {
  it("extracts the stream's provider::model API tails (real STREAMS)", () => {
    expect(apiVendorCandidates("errors-resilience")).toContainEqual({ vendor: "groq", model: "llama-3.3-70b-versatile" });
    expect(apiVendorCandidates("typescript-core")).toContainEqual({ vendor: "zai", model: "glm-4.7-flash" });
    expect(apiVendorCandidates("concurrency-safety")).toContainEqual({ vendor: "cerebras", model: "gpt-oss-120b" });
  });
  it("returns [] for an unknown stream", () => {
    expect(apiVendorCandidates("does-not-exist")).toEqual([]);
  });
  it("splits on '::' (two-char delimiter) — no leading colon in the model", () => {
    const c = apiVendorCandidates("errors-resilience")[0];
    expect(c.model.startsWith(":")).toBe(false);
  });
  it("ignores non-API (ollama/gemini) prefer entries and de-dupes repeated vendors", () => {
    const streams: StreamSpec[] = [{
      id: "s", lang: "TS", concern: "x",
      prefer: ["qwen3:8b", "gemini-2.5-flash", "groq::a", "groq::b", "cerebras::c"],
    }];
    expect(apiVendorCandidates("s", streams)).toEqual([
      { vendor: "groq", model: "a" }, // first groq wins (pref order); duplicate groq::b dropped
      { vendor: "cerebras", model: "c" },
    ]);
  });
});

describe("isActionableProposal", () => {
  it("accepts a real SEARCH/REPLACE proposal", () => {
    expect(isActionableProposal(SR)).toBe(true);
  });
  it("rejects empty / whitespace / too-short bodies", () => {
    expect(isActionableProposal("")).toBe(false);
    expect(isActionableProposal("   \n  ")).toBe(false);
    expect(isActionableProposal("## Change: tiny")).toBe(false); // has header but no SR block
  });
  it("rejects prose with no SEARCH/REPLACE block (not apply-shaped)", () => {
    expect(isActionableProposal("I think you should refactor the error handling to be more robust and add tests.")).toBe(false);
  });
});

describe("extractProposalText", () => {
  it("joins the agent-dispatch report's messages", () => {
    const out = JSON.stringify({ verdict: "DONE", messages: ["## Change", SR] });
    expect(extractProposalText(out)).toContain("SEARCH");
  });
  it("returns '' for empty messages / non-JSON / missing field", () => {
    expect(extractProposalText(JSON.stringify({ verdict: "DONE", messages: [] }))).toBe("");
    expect(extractProposalText(JSON.stringify({ verdict: "DONE" }))).toBe("");
    expect(extractProposalText("not json {")).toBe("");
    expect(extractProposalText("")).toBe("");
  });
});
