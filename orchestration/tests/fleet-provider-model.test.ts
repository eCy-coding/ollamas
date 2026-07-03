// T2-F3 — free-tier catalog providers as FLEET workers: `provider::model` entries in the
// prefer lists resolve by key liveness (readyApiProviders), run as "cloud" runtime (no GPU
// ticket), and dispatch with the bare model + explicit provider. Zero keys → plan unchanged.
import { describe, it, expect } from "vitest";
import { buildFleetPlan, runtimeOf, STREAMS } from "../bin/lib/fleet-plan";
import { providerFor, dispatchTarget } from "../bin/lib/chrome-probe";

describe("providerFor / dispatchTarget — provider::model parsing", () => {
  it("api-routed models resolve to their catalog provider; legacy rules intact", () => {
    expect(providerFor("groq::llama-3.3-70b-versatile")).toBe("groq");
    expect(providerFor("zai::glm-4.7-flash")).toBe("zai");
    expect(providerFor("qwen3-coder:480b-cloud")).toBe("ollama-cloud");
    expect(providerFor("qwen3:8b")).toBe("ollama-local");
    expect(providerFor("gemini-2.5-flash")).toBe("gemini-cli");
  });

  it("dispatchTarget strips the provider prefix so the API gets the bare model id", () => {
    expect(dispatchTarget("groq::llama-3.3-70b-versatile")).toEqual({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(dispatchTarget("qwen3:8b")).toEqual({ provider: "ollama-local", model: "qwen3:8b" });
    expect(dispatchTarget("qwen3-coder:480b-cloud")).toEqual({ provider: "ollama-cloud", model: "qwen3-coder:480b-cloud" });
  });
});

describe("runtimeOf — api models are cloud (parallelize, never take the GPU ticket)", () => {
  it("provider::model → cloud; bare ollama tags stay local", () => {
    expect(runtimeOf("groq::llama-3.3-70b-versatile")).toBe("cloud");
    expect(runtimeOf("cerebras::gpt-oss-120b")).toBe("cloud");
    expect(runtimeOf("qwen3:8b")).toBe("local");
  });
});

describe("buildFleetPlan — key-live api providers join the worker pool", () => {
  it("prefer lists carry api entries (fallback position, never first preference)", () => {
    const apiEntries = STREAMS.flatMap((s) => s.prefer.filter((m) => m.includes("::")));
    expect(apiEntries.length).toBeGreaterThan(0);
    for (const s of STREAMS) {
      if (s.prefer.some((m) => m.includes("::"))) {
        expect(s.prefer[0]).not.toContain("::"); // proven ollama seats stay first
      }
    }
  });

  it("no ollama models + zai key live → zai:: assignment appears with cloud runtime", () => {
    const plan = buildFleetPlan([], ["zai"]);
    const zai = plan.assignments.filter((a) => a.model?.startsWith("zai::"));
    expect(zai.length).toBeGreaterThan(0);
    for (const a of zai) expect(a.runtime).toBe("cloud");
  });

  it("no keys → identical to the legacy plan (backward compat)", () => {
    const legacy = buildFleetPlan(["qwen3:8b", "qwen3-coder:30b"]);
    const withEmpty = buildFleetPlan(["qwen3:8b", "qwen3-coder:30b"], []);
    expect(withEmpty).toEqual(legacy);
    expect(legacy.assignments.some((a) => a.model?.includes("::"))).toBe(false);
  });
});
