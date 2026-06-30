/**
 * Streaming fail-safe: a cancelled caller must never leave a provider stream hanging. The guard
 * (abortIfCancelled) throws between chunks, so a backend that streams PAST an abort — or never
 * closes its body — is cut instead of pinning reader.read() forever.
 */
import { describe, it, test, expect, vi, afterEach } from "vitest";
import { ProviderRouter, abortIfCancelled, type GenerateConfig } from "../server/providers";

afterEach(() => vi.restoreAllMocks());

describe("abortIfCancelled (pure)", () => {
  it("throws when the signal is already aborted", () => {
    expect(() => abortIfCancelled(AbortSignal.abort())).toThrow(/aborted/i);
  });
  it("no-op when the signal is live or absent", () => {
    expect(() => abortIfCancelled(new AbortController().signal)).not.toThrow();
    expect(() => abortIfCancelled(undefined)).not.toThrow();
  });
});

describe("streaming guard cuts a mid-stream abort (no hang)", () => {
  const CONFIG: GenerateConfig = { provider: "ollama-local", model: "test-model", messages: [{ role: "user", content: "hi" }] };

  test("aborting mid-stream stops the read loop on a never-closing body within 2s", async () => {
    // Hermetic chain: ollama-local (the streaming branch under test) → demo (resolves, no fetch).
    // Avoids fleet/cloud probes hitting the mocked fetch + any env-key dependence.
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue(["ollama-local", "demo"]);
    // A body that yields ONE chunk then NEVER closes: without the guard, the loop's next
    // reader.read() would pend forever (only the 300s timeout would eventually fire → hang).
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: "chunk1" }, done: false }) + "\n"));
              // intentionally never close / never enqueue more
            },
          }),
          { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
        ),
      ),
    );

    const controller = new AbortController();
    const start = Date.now();
    // Abort as soon as the first chunk arrives → the loop's NEXT iteration must throw via the guard.
    const p = ProviderRouter.generate(CONFIG, () => controller.abort(), undefined, controller.signal);

    // Race a 4s watchdog: if the guard works, generate settles fast (ollama loop throws → chain →
    // demo fallback resolves). If it hangs on the open stream, the watchdog rejects → test fails.
    const watchdog = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("generate() hung — guard missing")), 4000));
    await Promise.race([p.then(() => undefined).catch(() => undefined), watchdog]);

    expect(Date.now() - start).toBeLessThan(2000); // settled fast, never pinned on the open stream
  });
});
