import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StreamOpts } from "../src/lib/apiClient";

vi.mock("../src/lib/apiClient", () => ({
  api: { streamPost: vi.fn() },
}));

import { api } from "../src/lib/apiClient";
import {
  chatStreamStore,
  assistStreamStore,
  startChatStream,
  startAssistStream,
  __resetStreamStoresForTests,
  type ChatMsg,
} from "../src/lib/streamStore";

// Flush pending microtasks a bounded number of times — safe here because
// every gate in these tests is hand-resolved (deferredStreamPost / fake timers).
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function frame(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Drive a mocked api.streamPost by hand: push frames / resolve / reject whenever
 *  the test wants, instead of the mock delivering everything synchronously. This
 *  is what lets tests simulate "the stream keeps running while nobody's looking". */
function deferredStreamPost() {
  let capturedOpts!: StreamOpts;
  let resolveFn!: () => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolveFn = res; rejectFn = rej; });
  vi.mocked(api.streamPost).mockImplementation(async (_ep, _body, opts) => {
    capturedOpts = opts;
    return promise;
  });
  return {
    push: (f: Record<string, unknown>) => capturedOpts.onChunk(frame(f)),
    resolve: () => resolveFn(),
    reject: (e: unknown) => rejectFn(e),
  };
}

function paintChatDraft(key: string, draftId = "d1"): { base: ChatMsg[]; draftId: string } {
  const base: ChatMsg[] = [{ id: "u1", role: "user", content: "hi", timestamp: "t" }];
  chatStreamStore.set(key, {
    messages: [...base, { id: draftId, role: "assistant", content: "", timestamp: "t" }],
    streaming: false,
    error: "",
    tokS: null,
  });
  return { base, draftId };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetStreamStoresForTests();
});

describe("streamStore — KeyedStore core", () => {
  it("rename() moves an entry (and its accumulated state) to a new key", () => {
    chatStreamStore.set("chat:new", { messages: [{ id: "1", role: "user", content: "hey", timestamp: "t" }], streaming: true, error: "", tokS: null });
    chatStreamStore.rename("chat:new", "chat:abc");
    expect(chatStreamStore.getSnapshot("chat:abc").messages).toHaveLength(1);
    // old key is now a fresh default entry, not the migrated one
    expect(chatStreamStore.getSnapshot("chat:new").messages).toHaveLength(0);
  });

  it("getSnapshot returns a stable reference until the next patch/set", () => {
    const key = "chat:stable";
    const a = chatStreamStore.getSnapshot(key);
    const b = chatStreamStore.getSnapshot(key);
    expect(a).toBe(b);
    chatStreamStore.patch(key, { error: "x" });
    const c = chatStreamStore.getSnapshot(key);
    expect(c).not.toBe(a);
  });
});

describe("streamStore — chat stream", () => {
  it("accumulates streamed chunk frames into the draft message", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "p", model: "m" });
    d.push({ chunk: "Hel" });
    d.push({ chunk: "lo" });
    d.resolve();
    await flush();
    const snap = chatStreamStore.getSnapshot(key);
    expect(snap.messages.find((m) => m.id === draftId)?.content).toBe("Hello");
    expect(snap.streaming).toBe(false);
  });

  it("a subscriber added AFTER the stream started receives the current + future snapshots", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "p", model: "m" });
    d.push({ chunk: "partial" });
    await flush();

    // subscribing late still sees the current accumulated state via getSnapshot
    expect(chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId)?.content).toBe("partial");

    let seen = "";
    const unsub = chatStreamStore.subscribe(key, () => {
      seen = chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId)?.content ?? "";
    });
    d.push({ chunk: "-more" });
    await flush();
    expect(seen).toBe("partial-more");

    unsub();
    d.resolve();
    await flush();
  });

  it("unsubscribing does NOT stop the stream — a later re-subscribe sees the full result", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "p", model: "m" });

    const unsub = chatStreamStore.subscribe(key, () => {});
    d.push({ chunk: "a" });
    await flush();
    unsub(); // nobody is listening anymore

    d.push({ chunk: "b" });
    d.push({ chunk: "c" });
    d.resolve();
    await flush();

    // fresh read (equivalent to a remounted component re-subscribing) sees everything
    const snap = chatStreamStore.getSnapshot(key);
    expect(snap.messages.find((m) => m.id === draftId)?.content).toBe("abc");
    expect(snap.streaming).toBe(false);
  });

  it("start() twice on the same key runs the underlying stream ONCE", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "p", model: "m" });
    startChatStream({ key, base, draftId, provider: "p", model: "m" }); // idempotent no-op
    expect(vi.mocked(api.streamPost).mock.calls.length).toBe(1);
    d.resolve();
    await flush();
  });

  it("an error frame sets error state WITHOUT stopping the stream", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "p", model: "m" });
    d.push({ error: "GPU busy" });
    await flush();
    expect(chatStreamStore.getSnapshot(key).error).toBe("GPU busy");

    d.push({ chunk: "still works" });
    d.resolve();
    await flush();
    expect(chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId)?.content).toBe("still works");
  });

  it("times out after 120s with an honest error if the model never responds", async () => {
    vi.useFakeTimers();
    try {
      const key = "chat:test";
      const { base, draftId } = paintChatDraft(key);
      deferredStreamPost(); // never resolved — simulates a hung GPU
      startChatStream({ key, base, draftId, provider: "p", model: "m" });
      await vi.advanceTimersByTimeAsync(120_000);
      const snap = chatStreamStore.getSnapshot(key);
      expect(snap.streaming).toBe(false);
      expect(snap.error).toMatch(/timed out after 120s/);
      // honest failure drops the empty draft, same as the pre-store component behavior
      expect(snap.messages.find((m) => m.id === draftId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("abort() stops applying further frames", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "p", model: "m" });
    d.push({ chunk: "before" });
    await flush();

    chatStreamStore.abort(key);
    d.push({ chunk: "-after" }); // must be ignored
    d.resolve();
    await flush();

    expect(chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId)?.content).toBe("before");
  });

  // v20 — silent model substitution (honesty defect): the router can fall through
  // its provider chain and serve an answer from something other than what was
  // requested, with zero indication in the UI. The `done` frame already carries
  // the real `source` on the wire (server.ts); these tests lock in that the store
  // captures it (and the honest substituted/servedBy/latencyMs bookkeeping).
  it("a `done` frame carrying `source` populates servedBy + latencyMs on the finalized message", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "ollama-local", model: "ecy:latest" });
    d.push({ chunk: "Ankara." });
    d.push({ done: true, source: "ollama_local", latencyMs: 850 });
    d.resolve();
    await flush();

    const msg = chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId);
    expect(msg?.servedBy).toBe("ollama_local");
    expect(msg?.latencyMs).toBe(850);
  });

  it("a `done` frame WITHOUT `source` leaves servedBy undefined (no crash)", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "ollama-local", model: "ecy:latest" });
    d.push({ chunk: "hi" });
    d.push({ done: true }); // no source/latencyMs at all
    d.resolve();
    await flush();

    const snap = chatStreamStore.getSnapshot(key);
    const msg = snap.messages.find((m) => m.id === draftId);
    expect(msg?.content).toBe("hi"); // unaffected — the store tolerates the missing field
    expect(msg?.servedBy).toBeUndefined();
    expect(msg?.latencyMs).toBeUndefined();
    expect(snap.streaming).toBe(false);
  });

  it("flags `substituted: true` when the served source differs from the requested provider (the measured bug)", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    // User picked ecy:latest on ollama-local; the router silently fell through to gemini.
    startChatStream({ key, base, draftId, provider: "ollama-local", model: "ecy:latest" });
    d.push({ chunk: "nonsense about 1914-1918..." });
    d.push({ done: true, source: "cloud:gemini", latencyMs: 500 });
    d.resolve();
    await flush();

    const msg = chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId);
    expect(msg?.servedBy).toBe("cloud:gemini");
    expect(msg?.substituted).toBe(true);
  });

  it("leaves `substituted` falsy when the served source matches the requested provider (hyphen/underscore normalized)", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "ollama-local", model: "ecy:latest" });
    d.push({ chunk: "Paris." });
    // Real server source for the local case is underscored ("ollama_local"), while the
    // requested provider id is hyphenated ("ollama-local") — this must NOT read as a mismatch.
    d.push({ done: true, source: "ollama_local", latencyMs: 300 });
    d.resolve();
    await flush();

    const msg = chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId);
    expect(msg?.substituted).toBeFalsy();
  });

  it("leaves `substituted` falsy when no done frame ever carried a source (no false alarm on unknown provenance)", async () => {
    const key = "chat:test";
    const { base, draftId } = paintChatDraft(key);
    const d = deferredStreamPost();
    startChatStream({ key, base, draftId, provider: "ollama-local", model: "ecy:latest" });
    d.push({ chunk: "hi" });
    d.resolve(); // stream ends with no `done` frame at all — mirrors older/odd server responses
    await flush();

    const msg = chatStreamStore.getSnapshot(key).messages.find((m) => m.id === draftId);
    expect(msg?.substituted).toBeFalsy();
  });
});

describe("streamStore — assist stream", () => {
  it("accumulates chunks and strips <think> reasoning", async () => {
    const key = "assist:panel1";
    const d = deferredStreamPost();
    startAssistStream({ key, endpoint: "/api/ecym/panel/panel1", context: "ctx" });
    d.push({ chunk: "<think>secret</think>Answer." });
    await flush();
    expect(assistStreamStore.getSnapshot(key).text).toBe("Answer.");
    d.resolve();
    await flush();
    expect(assistStreamStore.getSnapshot(key).streaming).toBe(false);
  });

  it("start() twice on the same key runs the underlying stream ONCE", async () => {
    const key = "assist:panel2";
    const d = deferredStreamPost();
    startAssistStream({ key, endpoint: "/e", context: "c" });
    startAssistStream({ key, endpoint: "/e", context: "c" });
    expect(vi.mocked(api.streamPost).mock.calls.length).toBe(1);
    d.resolve();
    await flush();
  });

  it("an error frame sets error state", async () => {
    const key = "assist:panel3";
    const d = deferredStreamPost();
    startAssistStream({ key, endpoint: "/e", context: "c" });
    d.push({ error: "boom" });
    await flush();
    expect(assistStreamStore.getSnapshot(key).error).toBe("boom");
    d.resolve();
    await flush();
  });

  it("times out after 90s with an honest error if the specialist never responds", async () => {
    vi.useFakeTimers();
    try {
      const key = "assist:panel4";
      deferredStreamPost();
      startAssistStream({ key, endpoint: "/e", context: "c" });
      await vi.advanceTimersByTimeAsync(90_000);
      const snap = assistStreamStore.getSnapshot(key);
      expect(snap.streaming).toBe(false);
      expect(snap.error).toMatch(/90sn/);
    } finally {
      vi.useRealTimers();
    }
  });
});
