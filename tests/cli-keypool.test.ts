import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { pickPoolKey, unsealDisk, sealDisk } from "../cli/lib/config";
import { redactOlm, summarizeProvision } from "../cli/commands/keys";

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
