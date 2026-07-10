import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NO_LOCAL_MODEL_HELP,
  MAC_MODEL_CHAMPION,
  resolveDefaultModel,
  _resetDefaultModelCache,
} from "../server/ai";

// M-037 (V2): a fresh install with no model pulled used to throw a dead-end
// "no local ollama model available". First-run onboarding turns that into an
// actionable message that tells the user how to fix it.
describe("first-run model onboarding (M-037)", () => {
  beforeEach(() => _resetDefaultModelCache());

  it("help message is actionable — names 'ollama pull' and the champion model", () => {
    expect(NO_LOCAL_MODEL_HELP).toContain("ollama pull");
    expect(NO_LOCAL_MODEL_HELP).toContain(MAC_MODEL_CHAMPION);
    expect(NO_LOCAL_MODEL_HELP).not.toBe("no local ollama model available");
  });

  it("resolveDefaultModel throws the actionable help when no model is installed", async () => {
    // Every ollama base unreachable → listModels() returns [] → onboarding path.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    await expect(resolveDefaultModel()).rejects.toThrow(/ollama pull/);
    vi.unstubAllGlobals();
  });
});
