/**
 * FIX A2 (split-timeout stall guard + honest error labeling) and FIX A4 (chain-wide total
 * deadline) — ollama-local's PROVIDER_TIMEOUT_MS (300s) masked a 17-minute stall behind a
 * "unreachable" message even though the daemon answered /api/ps in ms — it's really a
 * model load/eviction stall on a STREAMING call, mislabeled. See server/providers.ts:
 * stallGuard / readOrAbort / honestOllamaError (ollama-local case) and the chain-deadline
 * gate at the top of ProviderRouter.generate's provider loop.
 *
 * Hermetic: fetch is fully mocked (no network/GPU), fallback chain pinned to avoid fleet/cloud
 * probes, vitest fake timers advance through the 45s/30s/120s windows without real waiting.
 * Follows tests/provider-abort.test.ts / tests/stream-abort.test.ts conventions.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderRouter, type GenerateConfig } from "../server/providers";

const CONFIG: GenerateConfig = {
  provider: "ollama-local",
  model: "test-model",
  messages: [{ role: "user", content: "hi" }],
};

/** A Response whose body stream never enqueues or closes — reader.read() hangs forever. */
function neverYieldsResponse() {
  return new Response(new ReadableStream({ start() { /* nothing — simulates a stalled model load */ } }), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

/** A Response whose body yields exactly one NDJSON chunk, then never closes/enqueues again. */
function oneChunkThenHangsResponse(chunkText: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: chunkText }, done: false }) + "\n"));
        // intentionally never enqueue again / never close — simulates a mid-generation eviction stall
      },
    }),
    { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ollama-local stall guard (FIX A2)", () => {
  test("streaming, first-token stall (45s): honest 'stalled' label when /api/ps proves the daemon reachable", async () => {
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue(["ollama-local"]);
    vi.stubGlobal("fetch", vi.fn((url: any) => {
      if (String(url).includes("/api/ps")) return Promise.resolve(new Response("{}", { status: 200 }));
      return Promise.resolve(neverYieldsResponse());
    }));

    const p = ProviderRouter.generate(CONFIG, () => {});
    let caught: any;
    const settled = p.catch((e) => { caught = e; });

    // Let the fetch mock + entry into the read loop settle before advancing the clock.
    await vi.advanceTimersByTimeAsync(0);
    // Cross the 45s first-token guard.
    await vi.advanceTimersByTimeAsync(46_000);
    await settled;

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/stalled/i);
    expect(caught.message).toMatch(/first token/i);
    expect(caught.message).toMatch(/reachable/i);
  });

  test("streaming, first-token stall (45s): keeps the honest 'unreachable' wording when /api/ps also fails", async () => {
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue(["ollama-local"]);
    vi.stubGlobal("fetch", vi.fn((url: any) => {
      if (String(url).includes("/api/ps")) return Promise.reject(new Error("connect ECONNREFUSED"));
      return Promise.resolve(neverYieldsResponse());
    }));

    const p = ProviderRouter.generate(CONFIG, () => {});
    let caught: any;
    const settled = p.catch((e) => { caught = e; });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(46_000);
    await settled;

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/unreachable/i);
    // Must NOT claim the daemon is reachable when the honesty probe itself failed.
    expect(caught.message).not.toMatch(/daemon reachable/i);
  });

  test("streaming, idle stall (30s): a chunk then silence still aborts (no hang)", async () => {
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue(["ollama-local"]);
    vi.stubGlobal("fetch", vi.fn((url: any) => {
      if (String(url).includes("/api/ps")) return Promise.resolve(new Response("{}", { status: 200 }));
      return Promise.resolve(oneChunkThenHangsResponse("partial"));
    }));

    const received: string[] = [];
    const p = ProviderRouter.generate(CONFIG, (c) => received.push(c));
    let caught: any;
    let resolved = false;
    const settled = p.then(() => { resolved = true; }, (e) => { caught = e; });

    // Flush the mocked fetch + first successful read (which rearms the idle timer via progress())
    // BEFORE advancing 30s of clock — otherwise the still-pending 45s first-token timer would win.
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toContain("partial");

    await vi.advanceTimersByTimeAsync(31_000);
    await settled;

    expect(resolved).toBe(false);
    expect(caught).toBeDefined(); // aborted — did not hang past the idle window
  });
});

describe("fallback-chain total deadline (FIX A4)", () => {
  test("gates further provider attempts once the chain-wide deadline is exceeded", async () => {
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue([
      "ollama-local", "ollama-local", "ollama-local", "ollama-local",
    ]);

    let attemptCount = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      attemptCount++;
      const n = attemptCount;
      // Each fetch takes ~50s of (fake) wall-clock time before genuinely failing — simulates a
      // slow-but-doomed provider, independent of the stall guard (non-streaming call → no
      // first-token/idle timers are even armed; this exercises ONLY the chain deadline). ollama-local
      // tries TWO host candidates (localhost, 127.0.0.1) per provider iteration, so one full
      // provider attempt costs ~100s here — that's fine, the deadline check only cares about
      // Date.now() vs. chainDeadline, not how many fetch calls got us there.
      return new Promise((_, reject) => setTimeout(() => reject(new Error(`boom #${n}`)), 50_000));
    }));

    // onFallback fires exactly once per provider-to-provider transition — a precise, host-loop-
    // independent count of how many providers actually got attempted (vs. gated by the deadline).
    let fallbackCount = 0;
    const p = ProviderRouter.generate(CONFIG, undefined, () => { fallbackCount++; }); // non-streaming
    let caught: any;
    const settled = p.catch((e) => { caught = e; });

    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(50_000);
    }
    await settled;

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/deadline/i);
    // 4 providers in the chain → 3 possible transitions if every one were attempted and failed.
    // The deadline must have gated at least the last one.
    expect(fallbackCount).toBeGreaterThanOrEqual(1);
    expect(fallbackCount).toBeLessThan(3);
  });

  test("always allows the FIRST provider attempt regardless of the deadline", async () => {
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue(["ollama-local"]);
    vi.stubGlobal("fetch", vi.fn((url: any) => {
      if (String(url).includes("/api/ps")) return Promise.resolve(new Response("{}", { status: 200 }));
      return Promise.resolve(
        new Response(JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true, eval_count: 1, eval_duration: 1e9 }), {
          status: 200,
        }),
      );
    }));

    const result = await ProviderRouter.generate(CONFIG);
    expect(result.text).toBe("ok");
  });
});
