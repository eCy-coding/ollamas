import { describe, it, expect } from "vitest";
import { ProviderRouter } from "../server/providers";
import { triggerKeyRescan } from "../server/key-health";

describe("buddy-system — buddyStatus", () => {
  it("reports every keyed cloud provider with a valid state + an active buddy", () => {
    // State-independent: the shared dev db may already hold real keys, so don't assume empty.
    const s = ProviderRouter.buddyStatus();
    expect(Array.isArray(s.providers)).toBe(true);
    expect(s.providers.length).toBeGreaterThan(3);
    expect(s.providers.map((p) => p.id)).toContain("gemini");
    for (const p of s.providers) {
      expect(["live", "saturated", "cooled", "absent"]).toContain(p.state);
      expect(p.worstPct).toBeGreaterThanOrEqual(0);
    }
    expect(typeof s.activeBuddy).toBe("string");
    expect(typeof s.allCloudCooled).toBe("boolean");
    // Invariant: if every cloud is cooled/absent, the active buddy must be the $0-local net.
    if (s.allCloudCooled) expect(s.activeBuddy).toMatch(/ollama-local/);
  });

  it("never lists a keyless provider as a keyed buddy (pollinations)", () => {
    const s = ProviderRouter.buddyStatus();
    expect(s.providers.map((p) => p.id)).not.toContain("pollinations");
  });
});

describe("buddy-system — triggerKeyRescan guard", () => {
  it("is a safe no-op when the health loop has not been started", () => {
    // startKeyHealth() is not called in this unit test → no timer → rescan can't fire.
    expect(triggerKeyRescan("test-reason")).toBe(false);
  });
});
