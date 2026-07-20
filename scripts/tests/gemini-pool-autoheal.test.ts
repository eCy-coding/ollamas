// gemini-pool-autoheal — classifies which dry providers get a real auto-provision attempt
// (gemini only, via the existing gcloud-based gemini-provision.mjs) vs. alert-only (everyone
// else — no CLI-based key issuance exists for them, so autoheal must never pretend otherwise).
import { describe, test, expect } from "vitest";
import { classifyDryProviders, remedyHint } from "../gemini-pool-autoheal.mjs";

describe("classifyDryProviders", () => {
  test("gemini dry → healable; other dry providers → alertOnly", () => {
    const pool = {
      gemini: { total: 8, live: 0 },
      openai: { total: 2, live: 0 },
      cohere: { total: 1, live: 0 },
    };
    const { healable, alertOnly } = classifyDryProviders(pool);
    expect(healable).toEqual(["gemini"]);
    expect(alertOnly.sort()).toEqual(["cohere", "openai"]);
  });

  test("healthy providers (live > 0) are excluded from both lists", () => {
    const pool = { gemini: { total: 8, live: 3 }, groq: { total: 1, live: 1 } };
    const { healable, alertOnly } = classifyDryProviders(pool);
    expect(healable).toEqual([]);
    expect(alertOnly).toEqual([]);
  });

  test("unconfigured providers (total === 0) are ignored, not flagged as dry", () => {
    const pool = { anthropic: { total: 0, live: 0 }, gemini: { total: 8, live: 0 } };
    const { healable, alertOnly } = classifyDryProviders(pool);
    expect(healable).toEqual(["gemini"]);
    expect(alertOnly).toEqual([]);
  });

  test("empty/missing pool → no crash, empty lists", () => {
    expect(classifyDryProviders({})).toEqual({ healable: [], alertOnly: [] });
    expect(classifyDryProviders(undefined)).toEqual({ healable: [], alertOnly: [] });
  });
});

describe("remedyHint", () => {
  test("github-models → the real semi-automatic fix, not a generic dashboard message", () => {
    const hint = remedyHint("github-models", { total: 3, live: 0, signupUrl: "https://github.com/settings/personal-access-tokens" });
    expect(hint).toContain("key-doctor.mjs --fix");
    expect(hint).not.toContain("github.com/settings/personal-access-tokens");
  });

  test("a dashboard-issued provider → its real signupUrl, not a placeholder", () => {
    const hint = remedyHint("openai", { total: 2, live: 0, signupUrl: "https://platform.openai.com/api-keys" });
    expect(hint).toContain("https://platform.openai.com/api-keys");
  });

  test("missing signupUrl → generic fallback, no crash", () => {
    const hint = remedyHint("mystery-provider", { total: 1, live: 0 });
    expect(hint).toMatch(/dashboard/i);
  });
});
