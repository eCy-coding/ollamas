// /v1/chat/completions (server.ts's odysseus-compat shim) — this is the ONLY code path eCym's
// `cloud()` escalation (~/.local/bin/ecym, factual/güncel queries) actually reaches. A catalog
// entry alone does NOT make a provider reachable here — this endpoint ignores `model` entirely
// and races a hardcoded provider list (reliableGenerate). Perplexity (sonar, live web-search
// grounding) was added to the FALLBACK tier only — the two fast leaders (cerebras/gemini) stay
// untouched, so this proves the fallback race actually lands on perplexity when everyone ahead
// of it in that tier fails, without needing a real network call to any provider.
//
// In-process HTTP against the real exported app, same technique as tests/routes-hardening.test.ts.
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { ProviderRouter } from "../server/providers";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

async function postV1(body: unknown) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("/v1/models — perplexity is listed", () => {
  test("GET /v1/models includes perplexity", async () => {
    const res = await fetch(`${base}/v1/models`);
    const json: any = await res.json();
    const ids = (json.data || []).map((m: any) => m.id);
    expect(ids).toContain("perplexity");
  });
});

describe("/v1/chat/completions — perplexity is a real fallback candidate", () => {
  test("when every provider ahead of it in the fallback tier fails, perplexity's answer is returned", async () => {
    const spy = vi.spyOn(ProviderRouter, "generate").mockImplementation(async (config: any) => {
      if (config.provider === "perplexity") return { text: "sonar-grounded-answer", source: "perplexity" } as any;
      return { text: "", source: config.provider } as any; // cerebras/gemini/groq/github-models/sambanova all miss
    });
    try {
      const { status, body } = await postV1({ messages: [{ role: "user", content: "güncel haber var mı?" }] });
      expect(status).toBe(200);
      expect(body.choices[0].message.content).toBe("sonar-grounded-answer");
    } finally {
      spy.mockRestore();
    }
  });

  test("perplexity is never called while a leader (cerebras/gemini) still has an answer", async () => {
    const calledProviders: string[] = [];
    const spy = vi.spyOn(ProviderRouter, "generate").mockImplementation(async (config: any) => {
      calledProviders.push(config.provider);
      if (config.provider === "cerebras") return { text: "fast-leader-answer", source: "cerebras" } as any;
      return { text: "", source: config.provider } as any;
    });
    try {
      const { body } = await postV1({ messages: [{ role: "user", content: "2+2 kaç eder?" }] });
      expect(body.choices[0].message.content).toBe("fast-leader-answer");
      expect(calledProviders).not.toContain("perplexity");
    } finally {
      spy.mockRestore();
    }
  });
});
