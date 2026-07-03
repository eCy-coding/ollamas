// T2-F7 — STT catalog (Groq Whisper free tier: 2,000 req/day on the SAME GROQ_API_KEY as
// chat — one signup, two modalities). Pure entry selection + multipart form building; the
// /api/ai/transcribe route forwards via fetch and 503s honestly without a key.
import { describe, it, expect } from "vitest";
import { STT_CATALOG, sttEntryFor, buildTranscribeForm } from "../server/stt-catalog";

describe("STT_CATALOG", () => {
  it("groq whisper entry is internally consistent and reuses the chat env key", () => {
    const e = STT_CATALOG.groq;
    expect(e.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(e.envKey).toBe("GROQ_API_KEY");
    expect(e.defaultModel).toBe("whisper-large-v3");
    expect(e.maxBytes).toBe(25 * 1024 * 1024);
  });
});

describe("sttEntryFor — key-gated selection", () => {
  it("groq key present → groq entry; absent → null (route answers 503 honestly)", () => {
    expect(sttEntryFor({ GROQ_API_KEY: "gsk" } as any)?.id).toBe("groq");
    expect(sttEntryFor({} as any)).toBeNull();
  });
});

describe("buildTranscribeForm — OpenAI-compat multipart", () => {
  it("carries file (with filename) + model fields", async () => {
    const buf = Buffer.from("RIFFfakeaudio");
    const form = buildTranscribeForm(STT_CATALOG.groq, buf, "sample.wav");
    expect(form.get("model")).toBe("whisper-large-v3");
    const file = form.get("file") as File;
    expect(file.name).toBe("sample.wav");
    expect(Buffer.from(await file.arrayBuffer()).equals(buf)).toBe(true);
  });
  it("oversize buffer → throws before any network call (honest 25MB cap)", () => {
    const big = Buffer.alloc(STT_CATALOG.groq.maxBytes + 1);
    expect(() => buildTranscribeForm(STT_CATALOG.groq, big, "big.wav")).toThrow(/25MB|maxBytes|too large/i);
  });
});
