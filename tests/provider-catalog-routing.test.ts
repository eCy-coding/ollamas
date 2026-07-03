// Faz 2 — catalog providers ride the shared OpenAI-compat path: env-key resolution via the
// catalog, fallback-chain membership, fetch wiring (URL + bearer + default model). Hermetic:
// fetch is mocked, keys come from stubbed env, singleAttempt pins the provider (no fallback).
import { describe, it, test, expect, vi, afterEach } from "vitest";
import { ProviderRouter, type GenerateConfig } from "../server/providers";
import { PROVIDER_CATALOG } from "../server/provider-catalog";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function openAiOkBody(text = "ok") {
  return JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
}

function cfg(provider: string, model = ""): GenerateConfig {
  return { provider, model, messages: [{ role: "user", content: "hi" }], singleAttempt: true };
}

describe("catalog providers — fallback chain membership", () => {
  it("default chain contains every catalog provider in the cloud tier (local-first, demo-last kept)", () => {
    const chain = ProviderRouter.getFallbackChain("openai");
    for (const id of Object.keys(PROVIDER_CATALOG)) expect(chain).toContain(id);
    expect(chain[0]).toBe("openai"); // requested provider first
    expect(chain[chain.length - 1]).toBe("demo"); // demo stays terminal
    expect(chain.indexOf("ollama-local")).toBeLessThan(chain.indexOf("groq")); // $0 local before cloud
  });

  it("a catalog provider is explicitly selectable (chain starts with it)", () => {
    expect(ProviderRouter.getFallbackChain("groq")[0]).toBe("groq");
    expect(ProviderRouter.getFallbackChain("cerebras")[0]).toBe("cerebras");
  });
});

describe("catalog providers — env key resolution (keyPool via catalog envKey)", () => {
  it("GROQ_API_KEY joins the groq pool (incl. _1..9 / CSV rotation names)", () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_base");
    vi.stubEnv("GROQ_API_KEY_1", "gsk_extra");
    const pool = ProviderRouter.keyPool("groq");
    expect(pool).toContain("gsk_base");
    expect(pool).toContain("gsk_extra");
  });

  it("ZAI_API_KEY resolves for zai", () => {
    vi.stubEnv("ZAI_API_KEY", "zai_k");
    expect(ProviderRouter.keyPool("zai")).toContain("zai_k");
  });
});

describe("catalog providers — shared openai-compat execution (mocked fetch)", () => {
  test("groq: POSTs to the catalog base URL with bearer key; default model fills in", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    let captured: { url?: string; init?: any } = {};
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      captured = { url: String(url), init };
      return new Response(openAiOkBody("groq says hi"), { status: 200 });
    }));
    const res = await ProviderRouter.generate(cfg("groq"));
    expect(captured.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(captured.init.headers.Authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(captured.init.body);
    expect(body.model).toBe(PROVIDER_CATALOG.groq.defaultModel);
    expect(res.text).toBe("groq says hi");
    expect(res.source).toBe("cloud:groq");
  });

  test("cerebras: explicit model wins over the catalog default", async () => {
    vi.stubEnv("CEREBRAS_API_KEY", "csk_test");
    let body: any = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(openAiOkBody(), { status: 200 });
    }));
    await ProviderRouter.generate(cfg("cerebras", "qwen-3-32b"));
    expect(body.model).toBe("qwen-3-32b");
  });

  test("cloudflare without CLOUDFLARE_ACCOUNT_ID fails honestly (no bogus fetch)", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf_test");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(ProviderRouter.generate(cfg("cloudflare"))).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("cloudflare with account id composes the per-account base URL", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf_test");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct42");
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (u: any) => { url = String(u); return new Response(openAiOkBody(), { status: 200 }); }));
    await ProviderRouter.generate(cfg("cloudflare"));
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct42/ai/v1/chat/completions");
  });

  test("streaming: SSE deltas reach onStreamChunk through the shared path", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const sse = [
      'data: {"choices":[{"delta":{"content":"he"}}]}',
      'data: {"choices":[{"delta":{"content":"llo"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    const chunks: string[] = [];
    const res = await ProviderRouter.generate(cfg("groq"), (t) => chunks.push(t));
    expect(chunks.join("")).toBe("hello");
    expect(res.text).toBe("hello");
  });
});
