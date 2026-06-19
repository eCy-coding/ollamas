// LiteLLM ↔ ollamas E2E wire (v1.7). Proves ollamas CONSUMES a LiteLLM proxy through
// the existing `custom-openai` provider path (server/providers.ts) — zero core code.
// Mirrors tests/ukp-upstream.e2e.test.ts: opt-in via RUN_LIVE_E2E, and skips cleanly
// when no proxy is reachable so CI stays green.
//
//   RUN_LIVE_E2E=1 LITELLM_BASE_URL=http://localhost:4000/v1 \
//     LITELLM_KEY=sk-ollamas-litellm-local LITELLM_MODEL=local-qwen \
//     npx vitest run tests/litellm-provider.e2e.test.ts
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";

const RUN_LIVE = process.env.RUN_LIVE_E2E === "1";
const BASE_URL = process.env.LITELLM_BASE_URL || "http://localhost:4000/v1";
const KEY = process.env.LITELLM_KEY || "sk-ollamas-litellm-local";
const MODEL = process.env.LITELLM_MODEL || "local-qwen";

async function proxyReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

describe("provider CONSUME — LiteLLM HTTP backend (custom-openai)", () => {
  test.skipIf(!RUN_LIVE)(
    "ProviderRouter routes a generate through the LiteLLM proxy",
    async (ctx) => {
      if (!(await proxyReachable())) {
        ctx.skip(); // opted-in but proxy down → skip, don't fail CI
        return;
      }
      process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-litellm-${process.pid}.db`);
      const { db } = await import("../server/db");
      const { ProviderRouter } = await import("../server/providers");

      // Wire exactly as deploy/litellm/README.md documents: endpoint raw, key encrypted.
      db.data.keys["custom-openai-endpoint"] = BASE_URL;
      db.data.keys["custom-openai"] = db.encrypt(KEY);

      const out = await ProviderRouter.generate({
        provider: "custom-openai",
        model: MODEL,
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
        temperature: 0,
      });

      // Must have routed via the proxy (not fallen back to ollama-local/demo).
      expect(out.source).toBe("cloud:custom-openai");
      expect(out.modelUsed).toBe(MODEL);
      expect(typeof out.text).toBe("string");
      expect(out.text.length).toBeGreaterThan(0);
    },
    30000,
  );
});
