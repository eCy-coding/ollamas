import { describe, it, expect } from "vitest";
import { parseSSEBuffer, GatewayClient } from "../cli/lib/client";

describe("parseSSEBuffer", () => {
  it("parses complete frames and keeps the partial remainder", () => {
    const { events, rest } = parseSSEBuffer(
      'data: {"chunk":"he"}\n\ndata: {"chunk":"llo"}\n\ndata: {"don',
    );
    expect(events).toEqual([{ chunk: "he" }, { chunk: "llo" }]);
    expect(rest).toBe('data: {"don');
  });

  it("ignores malformed frames without throwing", () => {
    const { events } = parseSSEBuffer("data: not-json\n\ndata: {\"chunk\":\"ok\"}\n\n");
    expect(events).toEqual([{ chunk: "ok" }]);
  });

  it("returns no events when no frame is complete", () => {
    expect(parseSSEBuffer('data: {"chunk":"x"}')).toEqual({ events: [], rest: 'data: {"chunk":"x"}' });
  });
});

describe("GatewayClient.generateStream", () => {
  it("streams chunks then resolves with final meta (mocked fetch)", async () => {
    const frames = [
      'data: {"chunk":"Hel"}\n\n',
      'data: {"chunk":"lo"}\n\n',
      'data: {"done":true,"source":"ollama_local","latencyMs":42,"tokensPerSec":30}\n\n',
    ];
    const body = readableFrom(frames);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as any;
    try {
      const client = new GatewayClient("http://x");
      const chunks: string[] = [];
      const meta = await client.generateStream([{ role: "user", content: "hi" }], {}, (c) => chunks.push(c));
      expect(chunks.join("")).toBe("Hello");
      expect(meta).toEqual({ source: "ollama_local", latencyMs: 42, tokensPerSec: 30 });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("throws on an error frame", async () => {
    const body = readableFrom(['data: {"error":"boom"}\n\n']);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as any;
    try {
      const client = new GatewayClient("http://x");
      await expect(client.generateStream([{ role: "user", content: "hi" }], {}, () => {})).rejects.toThrow("boom");
    } finally {
      globalThis.fetch = original;
    }
  });
});

function readableFrom(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < frames.length) controller.enqueue(enc.encode(frames[i++]));
      else controller.close();
    },
  });
}
