import { describe, test, expect } from "vitest";
import {
  summarizeFromDoctor,
  cheapHealthFromPool,
  nextBackoffMs,
  parseSources,
} from "../server/key-health";
import type { DoctorReport, ProviderVerdict } from "../server/key-doctor";

const verdict = (v: Partial<ProviderVerdict>): ProviderVerdict => ({
  status: "absent",
  capabilitiesActivated: [],
  ...v,
});

const report = (providers: Record<string, ProviderVerdict>): DoctorReport => ({
  providers,
  capabilityReport: {},
  roleSuggestions: { "cloud-alt": [], "fast-verify": [], adversarial: [] },
  dryRun: false,
});

describe("summarizeFromDoctor — fold doctor verdicts into a health snapshot", () => {
  test("connected/already/unverified count as live; absent/invalid do not", () => {
    const snap = summarizeFromDoctor(
      report({
        groq: verdict({ status: "already", source: "vault" }),
        gemini: verdict({ status: "connected", source: "env" }),
        mistral: verdict({ status: "connected-unverified", source: "vault" }),
        anthropic: verdict({ status: "absent", nextManualUrl: "https://console.anthropic.com" }),
        cloudflare: verdict({ status: "invalid", source: "env" }),
      }),
      1000,
    );
    expect(snap.total).toBe(5);
    expect(snap.live).toBe(3);
    expect(snap.converged).toBe(false);
    expect(snap.absent).toEqual(["anthropic"]);
    expect(snap.updatedAt).toBe(1000);
  });

  test("converged when every provider is live", () => {
    const snap = summarizeFromDoctor(
      report({
        groq: verdict({ status: "already", source: "vault" }),
        gemini: verdict({ status: "already", source: "env" }),
      }),
      1,
    );
    expect(snap.converged).toBe(true);
    expect(snap.absent).toEqual([]);
  });

  test("gh-sourced and gemini-cli/github-models are keyless-live (0-manual set)", () => {
    const snap = summarizeFromDoctor(
      report({
        "github-models": verdict({ status: "connected", source: "gh" }),
        "gemini-cli": verdict({ status: "already", source: "env" }),
        groq: verdict({ status: "already", source: "vault" }),
      }),
      1,
    );
    expect(snap.keylessLive.sort()).toEqual(["gemini-cli", "github-models"]);
    // a vault-keyed provider is live but NOT keyless
    expect(snap.keylessLive).not.toContain("groq");
  });

  test("a doctor-live keyed provider whose whole pool is cooled downgrades to cooled", () => {
    const cooled = new Set(["groq"]);
    const snap = summarizeFromDoctor(
      report({
        groq: verdict({ status: "already", source: "vault" }),
        gemini: verdict({ status: "already", source: "env" }),
      }),
      1,
      (p) => (cooled.has(p) ? 0 : 2),
    );
    const byId = Object.fromEntries(snap.providers.map((r) => [r.provider, r.status]));
    expect(byId.groq).toBe("cooled");
    expect(byId.gemini).toBe("live");
    expect(snap.live).toBe(1);
  });

  test("keyless provider is NOT downgraded even when pool is empty (no key needed)", () => {
    const snap = summarizeFromDoctor(
      report({ "github-models": verdict({ status: "connected", source: "gh" }) }),
      1,
      () => 0, // no pooled keys at all
    );
    expect(snap.providers[0].status).toBe("live");
    expect(snap.live).toBe(1);
  });

  test("non-live providers carry a signup URL; live ones do not", () => {
    const snap = summarizeFromDoctor(
      report({
        anthropic: verdict({ status: "absent", nextManualUrl: "https://a.co" }),
        groq: verdict({ status: "already", source: "vault" }),
      }),
      1,
    );
    const byId = Object.fromEntries(snap.providers.map((r) => [r.provider, r]));
    expect(byId.anthropic.signupUrl).toBe("https://a.co");
    expect(byId.groq.signupUrl).toBeUndefined();
  });
});

describe("cheapHealthFromPool — pool+catalog fallback (no doctor run)", () => {
  const poolStatus = (p: string): { total: number; live: number } =>
    ({ groq: { total: 2, live: 2 }, mistral: { total: 1, live: 0 }, anthropic: { total: 0, live: 0 } }[p] ?? {
      total: 0,
      live: 0,
    });

  test("live when pool has a live key OR provider is keyless; cooled when all cooled; absent when empty", () => {
    const snap = cheapHealthFromPool(
      ["groq", "mistral", "anthropic", "github-models"],
      poolStatus,
      (p) => p === "github-models",
      (p) => `https://signup/${p}`,
      5,
    );
    const byId = Object.fromEntries(snap.providers.map((r) => [r.provider, r.status]));
    expect(byId.groq).toBe("live");
    expect(byId.mistral).toBe("cooled");
    expect(byId.anthropic).toBe("absent");
    expect(byId["github-models"]).toBe("live"); // keyless, empty pool still live
    expect(snap.absent).toEqual(["anthropic"]);
    expect(snap.keylessLive).toEqual(["github-models"]);
  });
});

describe("nextBackoffMs — circuit-breaker backoff", () => {
  test("0 failures = base; grows by powers of two; capped at max", () => {
    expect(nextBackoffMs(0, 1000, 60_000)).toBe(1000);
    expect(nextBackoffMs(1, 1000, 60_000)).toBe(2000);
    expect(nextBackoffMs(3, 1000, 60_000)).toBe(8000);
    expect(nextBackoffMs(100, 1000, 60_000)).toBe(60_000); // capped
  });
});

describe("parseSources — validated source list", () => {
  test("defaults to env+gh (prompt-free) when unset or empty", () => {
    expect(parseSources(undefined)).toEqual(["env", "gh"]);
    expect(parseSources("")).toEqual(["env", "gh"]);
    expect(parseSources("bogus,nope")).toEqual(["env", "gh"]);
  });
  test("keeps only valid sources, in given order", () => {
    expect(parseSources("keychain,env")).toEqual(["keychain", "env"]);
    expect(parseSources("gh")).toEqual(["gh"]);
  });
});
