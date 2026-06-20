// Faz 28 (v1.19) — regression for a defect found by the LIVE run: ProviderRouter
// crashed with "Cannot read properties of undefined (reading 'find')" when a config
// arrived without a `messages` array (e.g. POST /api/generate with only a prompt).
// The router must degrade gracefully (demo fallback), never throw a TypeError.
import { describe, test, expect } from "vitest";
import { ProviderRouter } from "../server/providers";

describe("ProviderRouter messages guard (Faz 28)", () => {
  test("a config with no messages does not crash with a TypeError", async () => {
    // demo provider needs no network and ignores messages → safe, deterministic.
    const r = await ProviderRouter.generate({ provider: "demo", model: "m" } as any);
    expect(typeof r.text).toBe("string");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.source).toBeTruthy();
  });
});
