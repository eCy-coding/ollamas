import { describe, it, expect, afterEach } from "vitest";
import { GatewayClient, type AgentEvent } from "../cli/lib/client";

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

const original = globalThis.fetch;
afterEach(() => (globalThis.fetch = original));

describe("GatewayClient.agentStream", () => {
  it("forwards every event and resolves complete on done", async () => {
    const frames = [
      'data: {"type":"thought","text":"thinking"}\n\n',
      'data: {"type":"step","stepNum":1,"tool":"read_file","ok":true,"latency":12}\n\n',
      'data: {"type":"message","text":"here you go","step":1}\n\n',
      'data: {"type":"done","text":"finished","status":"complete"}\n\n',
    ];
    globalThis.fetch = (async () => new Response(readableFrom(frames), { status: 200 })) as any;
    const client = new GatewayClient("http://x");
    const seen: string[] = [];
    const res = await client.agentStream([{ role: "user", content: "go" }], {}, (ev: AgentEvent) => seen.push(ev.type));
    expect(seen).toEqual(["thought", "step", "message", "done"]);
    expect(res.status).toBe("complete");
    expect(res.history.some((m) => m.content === "here you go")).toBe(true);
  });

  it("captures a pending write on paused", async () => {
    const frames = [
      'data: {"type":"step","stepNum":1,"tool":"write_file","ok":true,"latency":5,"applied":false,"diff":"+x","args":{"path":"a.ts","content":"x"}}\n\n',
      'data: {"type":"paused","message":"awaiting approval"}\n\n',
    ];
    globalThis.fetch = (async () => new Response(readableFrom(frames), { status: 200 })) as any;
    const client = new GatewayClient("http://x");
    const res = await client.agentStream([{ role: "user", content: "write" }], {}, () => {});
    expect(res.status).toBe("paused");
    expect(res.pending).toEqual({ path: "a.ts", content: "x", diff: "+x" });
  });

  it("throws on an error event", async () => {
    const frames = ['data: {"type":"error","message":"loop blew up"}\n\n'];
    globalThis.fetch = (async () => new Response(readableFrom(frames), { status: 200 })) as any;
    const client = new GatewayClient("http://x");
    await expect(client.agentStream([{ role: "user", content: "x" }], {}, () => {})).rejects.toThrow("loop blew up");
  });

  it("surfaces a non-200 as an error", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as any;
    const client = new GatewayClient("http://x");
    await expect(client.agentStream([{ role: "user", content: "x" }], {}, () => {})).rejects.toThrow("401");
  });
});
