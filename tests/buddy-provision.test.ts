import { describe, it, expect, vi } from "vitest";
import { attemptProvision, provisionEnabled, type ProvisionDeps } from "../server/buddy-provision";

const ON = { ECY_AUTO_PROVISION: "1" } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

function deps(over: Partial<ProvisionDeps> = {}): ProvisionDeps {
  return {
    hasKey: () => false,
    addKey: vi.fn(async () => {}),
    ghToken: async () => "gho_" + "x".repeat(36),
    mintGeminiKey: async () => "AIza-minted",
    ...over,
  };
}

describe("buddy-provision — opt-in gate", () => {
  it("is disabled by default (no ECY_AUTO_PROVISION)", async () => {
    expect(provisionEnabled(OFF)).toBe(false);
    const d = deps();
    const r = await attemptProvision("gemini", d, OFF);
    expect(r.provisioned).toEqual([]);
    expect(d.addKey).not.toHaveBeenCalled();
  });
});

describe("buddy-provision — mint from already-authed tooling (opt-in)", () => {
  it("adds a gh token → github-models and a gcloud key → gemini", async () => {
    const add = vi.fn(async () => {});
    const r = await attemptProvision("gemini", deps({ addKey: add }), ON);
    expect(r.provisioned.sort()).toEqual(["gemini", "github-models"]);
    expect(add).toHaveBeenCalledWith("github-models", expect.stringMatching(/^gho_/));
    expect(add).toHaveBeenCalledWith("gemini", "AIza-minted");
  });

  it("skips a provider that already has a key", async () => {
    const add = vi.fn(async () => {});
    const r = await attemptProvision("gemini", deps({ addKey: add, hasKey: (p) => p === "gemini" }), ON);
    expect(r.provisioned).toEqual(["github-models"]); // gemini skipped
  });

  it("is fail-soft when tooling is missing or errors (never throws)", async () => {
    const r = await attemptProvision("gemini", deps({
      ghToken: async () => null,
      mintGeminiKey: async () => { throw new Error("gcloud not authed"); },
    }), ON);
    expect(r.provisioned).toEqual([]);
    expect(r.note).toMatch(/no token|gcloud/);
  });

  it("never mints without the tooling deps present (account-free by construction)", async () => {
    const add = vi.fn(async () => {});
    const r = await attemptProvision("gemini", { hasKey: () => false, addKey: add }, ON);
    expect(r.provisioned).toEqual([]);
    expect(add).not.toHaveBeenCalled();
  });
});
