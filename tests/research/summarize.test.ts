// O2 Faz 1 (docs/odyssey/05-features/research.md §FAZ 1) — the summarize layer.
// chunkForSummary is pure; summarizeSource is deps-injected (mock `deps.generate`,
// no ai.ts/ollama network) so the LLM fail-soft path is deterministically testable.
import { describe, it, expect } from "vitest";
import { chunkForSummary, summarizeSource } from "../../server/research/summarize";

describe("chunkForSummary (pure)", () => {
  it("splits text into chunks no longer than maxChars", () => {
    const text = "a".repeat(2500);
    const chunks = chunkForSummary(text, 1000);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  it("short text → a single chunk", () => {
    expect(chunkForSummary("hello", 6000)).toEqual(["hello"]);
  });

  it("empty text → empty array", () => {
    expect(chunkForSummary("", 6000)).toEqual([]);
  });
});

describe("summarizeSource (deps-injected LLM)", () => {
  const source = { title: "Ollama docs", url: "https://ollama.com/docs", text: "Ollama runs models locally via a REST API." };

  it("URL/title attribution is preserved through the summary", async () => {
    const generate = async () => "Ollama exposes a local REST API for running models.\n- local\n- REST API";
    const out = await summarizeSource(source, { generate });
    expect(out.url).toBe(source.url);
    expect(out.title).toBe(source.title);
    expect(out.summary).toContain("REST API");
    expect(out.keyPoints.length).toBeGreaterThan(0);
  });

  it("LLM unreachable → fails soft to the raw snippet (research is never cut short)", async () => {
    const generate = async () => {
      throw new Error("model unreachable");
    };
    const out = await summarizeSource(source, { generate });
    expect(out.url).toBe(source.url);
    expect(out.summary).toContain(source.text.slice(0, 50));
    expect(out.keyPoints).toEqual([]);
  });
});
