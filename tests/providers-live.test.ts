// Faz 6 — LIVE free-tier provider verification. OFF by default (unit suites stay hermetic);
// run explicitly once keys are in the env:
//
//   LIVE_PROVIDERS=1 npx vitest run tests/providers-live.test.ts
//
// For each catalog provider whose env key is present, one REAL completion is made with
// singleAttempt (no fallback/rotation — the provider's own verdict, /api/keys/test semantics).
// Providers without a key are skipped, never failed: keys arrive one signup at a time.
import { describe, it, expect } from "vitest";
import { ProviderRouter } from "../server/providers";
import { PROVIDER_CATALOG } from "../server/provider-catalog";

const LIVE = process.env.LIVE_PROVIDERS === "1";

describe.skipIf(!LIVE)("live free-tier providers (LIVE_PROVIDERS=1)", () => {
  for (const entry of Object.values(PROVIDER_CATALOG)) {
    const haveKey = !!(process.env[entry.envKey] || "").trim();
    const haveCf = entry.id !== "cloudflare" || !!(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
    it.skipIf(!haveKey || !haveCf)(`${entry.id}: one real completion via ${entry.envKey}`, async () => {
      const res = await ProviderRouter.generate({
        provider: entry.id,
        model: "",
        messages: [{ role: "user", content: "Reply with exactly one word: ok" }],
        singleAttempt: true,
      });
      expect(res.source).toBe(`cloud:${entry.id}`);
      expect(res.text.trim().length).toBeGreaterThan(0);
    }, 60_000);
  }
});
