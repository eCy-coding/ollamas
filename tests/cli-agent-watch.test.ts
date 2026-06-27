import { describe, it, expect, afterEach } from "vitest";
import { nextBackoff, renderWatchEvent, parseWatchSSEBuffer, buildPickerPrompt } from "../cli/lib/watch";
import { GatewayClient } from "../cli/lib/client";

// ---------------------------------------------------------------------------
// nextBackoff — exponential backoff helpers
// ---------------------------------------------------------------------------
describe("nextBackoff", () => {
  it("attempt=0 returns less than base when jitter is on (default)", () => {
    // With jitter=true, result is in [0, base)
    for (let i = 0; i < 20; i++) {
      const v = nextBackoff(0, { base: 500, cap: 15000 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(500);
    }
  });

  it("without jitter is monotonically non-decreasing and hits cap", () => {
    const vals = [0, 1, 2, 3, 4, 5, 10].map((a) => nextBackoff(a, { base: 500, cap: 15000, jitter: false }));
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    // large attempt must saturate at cap
    expect(nextBackoff(100, { base: 500, cap: 15000, jitter: false })).toBe(15000);
  });

  it("never exceeds cap regardless of jitter", () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const v = nextBackoff(attempt, { base: 500, cap: 1000 });
      expect(v).toBeLessThanOrEqual(1000);
    }
  });

  it("respects custom base and cap", () => {
    expect(nextBackoff(0, { base: 100, cap: 200, jitter: false })).toBe(100);
    expect(nextBackoff(5, { base: 100, cap: 200, jitter: false })).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// renderWatchEvent — role-aware rendering
// ---------------------------------------------------------------------------
describe("renderWatchEvent", () => {
  it("user role gets > prefix", () => {
    expect(renderWatchEvent({ role: "user", content: "hello" })).toBe("> hello");
  });

  it("assistant role is bare content", () => {
    expect(renderWatchEvent({ role: "assistant", content: "world" })).toBe("world");
  });

  it("tool role gets [tool] prefix", () => {
    expect(renderWatchEvent({ role: "tool", content: "result" })).toBe("[tool] result");
  });

  it("system role gets [system] prefix", () => {
    expect(renderWatchEvent({ role: "system", content: "ctx" })).toBe("[system] ctx");
  });

  it("unknown role is bracketed", () => {
    expect(renderWatchEvent({ role: "debug", content: "x" })).toBe("[debug] x");
  });

  it("falls back to type field when role absent", () => {
    expect(renderWatchEvent({ type: "assistant", text: "hi" })).toBe("hi");
  });

  it("empty content renders empty body", () => {
    expect(renderWatchEvent({ role: "assistant", content: "" })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseWatchSSEBuffer — frame parsing
// ---------------------------------------------------------------------------
describe("parseWatchSSEBuffer", () => {
  it("parses single data frame", () => {
    const buf = 'id: 0\ndata: {"role":"user","content":"hi"}\n\n';
    const { events, done, rest } = parseWatchSSEBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(0);
    expect(events[0].data.role).toBe("user");
    expect(done).toBe(false);
    expect(rest).toBe("");
  });

  it("detects event:done and stops", () => {
    const buf = 'id: 2\ndata: {"role":"assistant","content":"done"}\n\nevent: done\ndata: {"status":"complete"}\n\n';
    const { events, done } = parseWatchSSEBuffer(buf);
    expect(events).toHaveLength(1);
    expect(done).toBe(true);
  });

  it("keeps partial frame in rest", () => {
    const buf = 'id: 0\ndata: {"role":"user","content":"hi"}\n\nid: 1\ndata: {"role"';
    const { events, rest } = parseWatchSSEBuffer(buf);
    expect(events).toHaveLength(1);
    expect(rest).toContain("id: 1");
  });

  it("ignores malformed JSON silently", () => {
    const buf = "id: 0\ndata: not-json\n\n";
    const { events } = parseWatchSSEBuffer(buf);
    expect(events).toHaveLength(0);
  });

  it("keep-alive comments (colon lines) produce no events", () => {
    const buf = ":\n\nid: 0\ndata: {\"role\":\"assistant\",\"content\":\"ok\"}\n\n";
    const { events } = parseWatchSSEBuffer(buf);
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildPickerPrompt — pure string builder
// ---------------------------------------------------------------------------
describe("buildPickerPrompt", () => {
  it("numbers sessions starting at 1", () => {
    const out = buildPickerPrompt([
      { id: "abcdef1234", title: "My task" },
      { id: "0000000000", title: "Another" },
    ]);
    expect(out).toContain("1)");
    expect(out).toContain("2)");
    expect(out).toContain("abcdef12");
    expect(out).toContain("My task");
  });

  it("truncates long titles to 40 chars", () => {
    const title = "A".repeat(60);
    const out = buildPickerPrompt([{ id: "abc123def456", title }]);
    // Only first 40 chars of title should appear
    expect(out).toContain("A".repeat(40));
    expect(out).not.toContain("A".repeat(41));
  });
});

// ---------------------------------------------------------------------------
// GatewayClient.watchSession — mocked fetch
// ---------------------------------------------------------------------------
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

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("GatewayClient.watchSession", () => {
  it("delivers parsed events and stops on event:done", async () => {
    const frames = [
      'id: 0\ndata: {"role":"user","content":"hello"}\n\n',
      'id: 1\ndata: {"role":"assistant","content":"hi"}\n\n',
      'event: done\ndata: {"status":"complete"}\n\n',
    ];
    globalThis.fetch = (async () => new Response(readableFrom(frames), { status: 200 })) as any;
    const client = new GatewayClient("http://x", "key");
    const seen: any[] = [];
    await client.watchSession("sess1", { after: -1 }, (ev) => seen.push(ev), new AbortController().signal);
    expect(seen).toHaveLength(2);
    expect(seen[0].data.role).toBe("user");
    expect(seen[1].data.role).toBe("assistant");
  });

  it("uses after param in query string", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(readableFrom(['event: done\ndata: {}\n\n']), { status: 200 });
    }) as any;
    const client = new GatewayClient("http://x", "key");
    await client.watchSession("abc", { after: 5 }, () => {}, new AbortController().signal);
    expect(capturedUrl).toContain("after=5");
    expect(capturedUrl).toContain("/api/agent/sessions/abc/events");
  });

  it("sends Accept text/event-stream header", async () => {
    let capturedHeaders: any = {};
    globalThis.fetch = (async (_url: string, init: any) => {
      capturedHeaders = init?.headers ?? {};
      return new Response(readableFrom(['event: done\ndata: {}\n\n']), { status: 200 });
    }) as any;
    const client = new GatewayClient("http://x", "mykey");
    await client.watchSession("abc", {}, () => {}, new AbortController().signal);
    expect(capturedHeaders["Accept"]).toBe("text/event-stream");
    expect(capturedHeaders["Authorization"]).toBe("Bearer mykey");
  });

  it("throws on non-200", async () => {
    globalThis.fetch = (async () => new Response("err", { status: 404 })) as any;
    const client = new GatewayClient("http://x");
    await expect(client.watchSession("x", {}, () => {}, new AbortController().signal)).rejects.toThrow("404");
  });

  it("--json mode: emits raw JSON line per event (no drop)", async () => {
    // Verify watchSession delivers ALL events including duplicates (no coalesce)
    const frames = [
      'id: 0\ndata: {"role":"assistant","content":"a"}\n\n',
      'id: 0\ndata: {"role":"assistant","content":"a"}\n\n', // duplicate id
      'event: done\ndata: {}\n\n',
    ];
    globalThis.fetch = (async () => new Response(readableFrom(frames), { status: 200 })) as any;
    const client = new GatewayClient("http://x");
    const seen: any[] = [];
    await client.watchSession("s", {}, (ev) => seen.push(ev), new AbortController().signal);
    // Both events delivered — no dedup/coalesce
    expect(seen).toHaveLength(2);
  });
});
