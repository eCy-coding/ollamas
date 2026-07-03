// T5-F2 — the ProviderRouter.generate choke point emits exactly one telemetry event per
// model operation: an "ok" event with TTFT on a streamed success, and an "error" event with
// the HTTP status errorType on a 429. Telemetry never throws into the model path.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderRouter, type GenerateConfig } from "../server/providers";
import { onRequestEvent, resetTelemetry, type RequestEvent } from "../server/telemetry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetTelemetry();
});
beforeEach(() => resetTelemetry());

function capture(): RequestEvent[] {
  const seen: RequestEvent[] = [];
  onRequestEvent((e) => seen.push(e));
  return seen;
}

const cfg = (over: Partial<GenerateConfig> = {}): GenerateConfig => ({
  provider: "groq", model: "", messages: [{ role: "user", content: "hi" }], singleAttempt: true, ...over,
});

describe("generate → telemetry event on success (streamed)", () => {
  it("emits one ok event carrying provider/model/tokens/ttft/tokPerSec", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_wire_test");
    const sse = ['data: {"choices":[{"delta":{"content":"he"}}]}', 'data: {"choices":[{"delta":{"content":"llo"}}]}', "data: [DONE]", ""].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    const seen = capture();
    await ProviderRouter.generate(cfg(), () => {});
    const ok = seen.filter((e) => e.status === "ok");
    expect(ok).toHaveLength(1);
    expect(ok[0].providerName).toBe("groq");
    expect(ok[0].stream).toBe(true);
    expect(ok[0].ttftMs).toBeGreaterThanOrEqual(0); // first chunk timed
    expect(ok[0].outputTokens).toBeGreaterThan(0);
    expect(ok[0].requestId).toBeTruthy();
    expect(ok[0].keyId).toMatch(/^[0-9a-f]{6,}$/); // pool-slot label, never the raw key
  });
});

describe("generate → telemetry event on failure (429)", () => {
  it("emits an error event with errorType from the HTTP status + quota flag", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_wire_429");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "5" } })));
    const seen = capture();
    await expect(ProviderRouter.generate(cfg())).rejects.toThrow(/429/);
    const err = seen.filter((e) => e.status === "error");
    expect(err.length).toBeGreaterThanOrEqual(1);
    expect(err[0].providerName).toBe("groq");
    expect(err[0].errorType).toContain("429");
    expect(err[0].quotaCooldownFlag).toBe(true);
  });
});

describe("telemetry is side-effect-safe", () => {
  it("a throwing subscriber never breaks generate()", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_safe");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })));
    onRequestEvent(() => { throw new Error("subscriber boom"); });
    await expect(ProviderRouter.generate(cfg())).resolves.toBeTruthy();
  });

  it("SECURITY: no emitted event leaks the raw key", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_supersecretwirevalue");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })));
    const seen = capture();
    await ProviderRouter.generate(cfg());
    expect(JSON.stringify(seen)).not.toContain("gsk_supersecretwirevalue");
  });
});
