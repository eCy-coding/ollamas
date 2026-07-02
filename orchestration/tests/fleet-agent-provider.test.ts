import { describe, it, expect } from "vitest";
import { providerFor } from "../bin/lib/chrome-probe";

// Regression lock for vO39: fleet-agent dispatched EVERY model through "ollama-local", so cloud slots
// (…-cloud) silently returned verdict=ERROR (the local daemon can't serve a cloud model). The fix routes
// each slot by providerFor(model). These assertions pin the mapping fleet-agent now relies on.
describe("fleet-agent provider routing (vO39 root-fix)", () => {
  it("routes every cloud tag the fleet uses to ollama-cloud", () => {
    for (const m of ["gpt-oss:20b-cloud", "gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "kimi-k2.5:cloud"]) {
      expect(providerFor(m)).toBe("ollama-cloud");
    }
  });

  it("keeps local tags on ollama-local (single-GPU workers)", () => {
    for (const m of ["qwen3:8b", "qwen3-coder:30b", "gpt-oss:20b", "deepseek-r1:32b", "phi4:latest"]) {
      expect(providerFor(m)).toBe("ollama-local");
    }
  });
});
