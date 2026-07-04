import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { pickPoolKey, unsealDisk, sealDisk } from "../cli/lib/config";
import { redactOlm, summarizeProvision, onboardTargets } from "../cli/commands/keys";

describe("cli key-pool — pickPoolKey rotation (client-side)", () => {
  it("picks a pool member; spreads across the pool with the injected rng", () => {
    const cfg = { apiKey: "olm_single", apiKeyPool: ["olm_a", "olm_b", "olm_c"] };
    expect(pickPoolKey(cfg, () => 0)).toBe("olm_a");
    expect(pickPoolKey(cfg, () => 0.5)).toBe("olm_b");
    expect(pickPoolKey(cfg, () => 0.99)).toBe("olm_c");
  });
  it("falls back to the single apiKey when no pool (non-breaking)", () => {
    expect(pickPoolKey({ apiKey: "olm_single" })).toBe("olm_single");
    expect(pickPoolKey({ apiKey: "olm_single", apiKeyPool: [] })).toBe("olm_single");
    expect(pickPoolKey({})).toBeUndefined();
  });
});

describe("cli key-pool — sealed at rest (round-trip)", () => {
  const key = crypto.randomBytes(32);
  it("seals + unseals the olm_ pool via AES-256-GCM", () => {
    const disk = sealDisk({ gateway: "http://g", apiKeyPool: ["olm_x", "olm_y"] }, key);
    expect(disk.apiKeyPoolEnc).toBeTruthy();
    expect(JSON.stringify(disk)).not.toContain("olm_x"); // sealed, not plaintext
    const { fileData } = unsealDisk(disk, key);
    expect(fileData.apiKeyPool).toEqual(["olm_x", "olm_y"]);
  });
  it("a single apiKey config still round-trips (back-compat)", () => {
    const disk = sealDisk({ gateway: "http://g", apiKey: "olm_solo" }, key);
    expect(unsealDisk(disk, key).fileData.apiKey).toBe("olm_solo");
    expect(unsealDisk(disk, key).fileData.apiKeyPool).toBeUndefined();
  });
});

describe("cli keys command — pure helpers", () => {
  it("redactOlm hides olm_ keys", () => {
    expect(redactOlm("error with olm_deadbeef0123456789abcdef here")).toContain("olm_…REDACTED");
    expect(redactOlm("error with olm_deadbeef0123456789abcdef here")).not.toContain("deadbeef");
  });
  it("summarizeProvision reports counts, no secrets", () => {
    expect(summarizeProvision(3, 3, 5)).toBe("Provisioned 3/3 olm_ key(s). Pool now: 5 key(s) (rotated per call).");
  });
});

describe("cli keys onboard — onboardTargets (pool → guided signup sırası)", () => {
  const POOL = {
    "nvidia-nim": { total: 0, live: 0, signupUrl: "https://build.nvidia.com", envKey: "NVIDIA_API_KEY" },
    gemini: { total: 9, live: 0, signupUrl: "https://aistudio.google.com/apikey", envKey: "GEMINI_API_KEY" },
    cerebras: { total: 1, live: 1, signupUrl: "https://cloud.cerebras.ai", envKey: "CEREBRAS_API_KEY" },
    weird: { total: 0, live: 0, signupUrl: "", envKey: "" }, // signupUrl yok → elenir
  };

  it("missing → exhausted → live sırasıyla döner; signupUrl'süz elenir", () => {
    const t = onboardTargets(POOL);
    expect(t.map((x) => x.id)).toEqual(["nvidia-nim", "gemini", "cerebras"]);
    expect(t[0].state).toBe("missing");
    expect(t[1].state).toBe("exhausted");
    expect(t[2].state).toBe("live");
  });
  it("signupUrl + envKey satırda taşınır (rehber çıktı için)", () => {
    const t = onboardTargets(POOL);
    expect(t[0].signupUrl).toContain("nvidia");
    expect(t[0].envKey).toBe("NVIDIA_API_KEY");
  });
  it("boş/bozuk pool → boş liste (asla throw)", () => {
    expect(onboardTargets({})).toEqual([]);
    expect(onboardTargets(null as any)).toEqual([]);
  });
});
