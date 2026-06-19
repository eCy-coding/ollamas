import { describe, it, expect } from "vitest";
import { formatProgress } from "../cli/lib/mcp";
import { GatewayClient } from "../cli/lib/client";

const noColor = { color: false, json: false };

describe("formatProgress (pure)", () => {
  it("shows percent when total is known", () => {
    expect(formatProgress({ progress: 3, total: 10, message: "building" }, noColor)).toBe("⟳ 3/10 (30%) building");
  });
  it("omits percent + total when total is absent", () => {
    expect(formatProgress({ progress: 5 }, noColor)).toBe("⟳ 5");
  });
  it("defaults progress to 0", () => {
    expect(formatProgress({}, noColor)).toBe("⟳ 0");
  });
});

describe("GatewayClient.mcpCallToolStream (mock SSE)", () => {
  it("emits each notifications/progress frame then resolves with the result", async () => {
    const original = globalThis.fetch;
    // Two progress notifications, then the terminal JSON-RPC reply — all on the
    // one SSE body, exactly as the gateway streams a long tools/call.
    const frames = [
      { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1, total: 2, message: "step1" } },
      { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 2, total: 2, message: "step2" } },
      { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "done" }] } },
    ];
    const body = frames.map((f) => `event: message\ndata: ${JSON.stringify(f)}\n\n`).join("");
    let sentBody: any;
    globalThis.fetch = (async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;
    try {
      const progress: number[] = [];
      const r = await new GatewayClient("http://x", "olm_key").mcpCallToolStream(
        "long_tool",
        { n: 2 },
        (p) => progress.push(p.progress ?? -1),
      );
      expect(sentBody).toMatchObject({ method: "tools/call", params: { name: "long_tool", arguments: { n: 2 } } });
      expect(progress).toEqual([1, 2]);
      expect(r.content?.[0]?.text).toBe("done");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("throws when the stream carries an error envelope", async () => {
    const original = globalThis.fetch;
    const body = `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "kaboom" } })}\n\n`;
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as any;
    try {
      await expect(
        new GatewayClient("http://x", "k").mcpCallToolStream("t", {}, () => {}),
      ).rejects.toThrow(/kaboom/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("maps a 401 to the OLLAMAS_API_KEY hint", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as any;
    try {
      await expect(
        new GatewayClient("http://x").mcpCallToolStream("t", {}, () => {}),
      ).rejects.toThrow(/OLLAMAS_API_KEY/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
