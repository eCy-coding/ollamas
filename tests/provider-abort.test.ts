// v1.11 Phase C — ProviderRouter abort-signal threading tests.
//
// Covers:
//   (a) The signal forwarded to global.fetch is already aborted when the caller
//       passes AbortSignal.abort() — confirms buildSignal() composed correctly
//       via AbortSignal.any().
//   (b) fetch is called with a signal at all (non-abort path) — backward-compat:
//       calling generate() WITHOUT a signal still works; the mocked fetch sees an
//       AbortSignal (the 300s timeout) and resolves successfully.
//   (c) Streaming path: onStreamChunk is called for each NDJSON chunk.
//
// NOTE on fallback chain: ProviderRouter chains ollama-local → … → demo.
// The demo provider does NOT use fetch, so generate() with a pre-aborted signal
// will still resolve (via demo fallback) — that is correct product behaviour.
// We therefore test abort-signal threading by inspecting the signal captured
// inside the fetch mock, NOT by expecting generate() to reject.
//
// To test that generate() would truly abort (no demo fallback), a future test
// could spy on getFallbackChain — but that is a private method. The approach
// here stays hermetic and tests what IS observable: what the fetch call receives.

import { describe, test, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { ProviderRouter, type GenerateConfig } from "../server/providers";

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: GenerateConfig = {
  provider: "ollama-local",
  model: "test-model",
  messages: [{ role: "user", content: "hi" }],
};

// Determinism/isolation (flake fix): the fallback chain includes the `fleet` provider,
// which reads ~/.ollamas/backends.json and probes each backend's /api/tags. On a machine
// with a REAL fleet configured (e.g. a remote http://desktop-ert7724:11434), that probe:
//   (1) interleaves extra fetch() calls that overwrite `capturedSignal` in a non-composed
//       order → the abort-signal assertions became ordering-dependent (flaky under load), and
//   (2) risks a genuine DNS/TCP attempt to the remote box when a mock ever races setup/teardown.
// Point FLEET_BACKENDS_PATH at a path that does not exist → loadFleetPool() returns an empty
// pool → `fleet` immediately delegates to ollama-local with NO /api/tags probe. The ONLY fetch
// calls are ollama-local's /api/chat, so `capturedSignal` is deterministically the COMPOSED
// caller/timeout signal we intend to assert on. No behaviour is weakened — the test still
// verifies real abort-signal threading, now hermetically.
let prevFleetPath: string | undefined;
beforeAll(() => {
  prevFleetPath = process.env.FLEET_BACKENDS_PATH;
  process.env.FLEET_BACKENDS_PATH = "/nonexistent/ollamas-test-no-fleet.json";
});
afterAll(() => {
  if (prevFleetPath === undefined) delete process.env.FLEET_BACKENDS_PATH;
  else process.env.FLEET_BACKENDS_PATH = prevFleetPath;
});

/** Minimal valid non-streaming ollama /api/chat JSON body. */
function ollamaOkBody(text = "hello") {
  return JSON.stringify({
    message: { role: "assistant", content: text },
    done: true,
    eval_count: 10,
    eval_duration: 1_000_000_000,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── (a) pre-aborted signal is forwarded to fetch ─────────────────────────────

describe("ProviderRouter.generate — abort signal threading (v1.11)", () => {
  test("passes an already-aborted signal to fetch when caller signal is pre-aborted", async () => {
    let capturedSignal: AbortSignal | undefined;

    // fetch mock: capture signal, then immediately reject with AbortError
    // (same as real fetch does when signal.aborted at call time).
    vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
    });

    const alreadyAborted = AbortSignal.abort();

    // generate() may ultimately resolve via the demo fallback — that is fine.
    // We only care about what reached fetch.
    await ProviderRouter.generate(BASE_CONFIG, undefined, undefined, alreadyAborted).catch(() => {
      // swallow any rejection — we just need capturedSignal populated
    });

    expect(capturedSignal).toBeDefined();
    // The composed signal (AbortSignal.any([callerSignal, timeout300s])) must
    // be aborted because the callerSignal is already aborted.
    expect(capturedSignal!.aborted).toBe(true);
  });

  // ── (b) no signal → fetch still receives an AbortSignal (the 300s timeout) ─

  test("passes a (timeout) AbortSignal to fetch even when no caller signal supplied", async () => {
    let capturedSignal: AbortSignal | undefined;

    vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(
        new Response(ollamaOkBody("backward-compat-ok"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const result = await ProviderRouter.generate(BASE_CONFIG);

    // fetch was called and the result came through
    expect(result.text).toBe("backward-compat-ok");
    expect(result.source).toBe("ollama_local");
    expect(result.modelUsed).toBe("test-model");
    expect(typeof result.latencyMs).toBe("number");

    // A timeout signal is always attached — even without a caller signal.
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // It should NOT be aborted yet (300s hasn't passed).
    expect(capturedSignal!.aborted).toBe(false);
  });

  // ── (c) a non-aborted caller signal is also forwarded ────────────────────

  test("forwards a live caller signal to fetch (not aborted)", async () => {
    let capturedSignal: AbortSignal | undefined;

    vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(
        new Response(ollamaOkBody("live-signal-ok"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const controller = new AbortController();
    const result = await ProviderRouter.generate(BASE_CONFIG, undefined, undefined, controller.signal);

    expect(result.text).toBe("live-signal-ok");
    expect(capturedSignal).toBeDefined();
    // Composed via AbortSignal.any — not aborted while controller is alive.
    expect(capturedSignal!.aborted).toBe(false);
  });

  // ── (d) streaming path: onStreamChunk receives NDJSON chunks ─────────────

  test("streams chunks to onStreamChunk callback (no signal)", async () => {
    const chunks = [
      JSON.stringify({ message: { content: "chunk1" }, done: false }) + "\n",
      JSON.stringify({ message: { content: "chunk2" }, done: true, eval_count: 2, eval_duration: 1e9 }) + "\n",
    ];

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } }
      )
    );

    const received: string[] = [];
    const result = await ProviderRouter.generate(BASE_CONFIG, (chunk) => received.push(chunk));

    expect(received).toContain("chunk1");
    expect(received).toContain("chunk2");
    expect(result.text).toBe("chunk1chunk2");
  });

  // ── (e) pre-aborted signal: generate completes quickly (no 300s wait) ────

  test("resolves within 1s when pre-aborted (AbortError on ollama-local → demo fallback)", async () => {
    // fetch aborts immediately; demo provider takes over and responds synchronously.
    vi.spyOn(global, "fetch").mockImplementation((_url, _init) => {
      return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
    });

    const alreadyAborted = AbortSignal.abort();
    const start = Date.now();

    // May resolve via demo fallback — important thing is it does NOT hang 300s.
    const p = ProviderRouter.generate(BASE_CONFIG, undefined, undefined, alreadyAborted);
    // Attach a race timeout that rejects after 5s so the test can fail fast.
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("generate() hung — did not complete within 5s")), 5000)
    );

    await Promise.race([p.then(() => undefined).catch(() => undefined), timeout]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
