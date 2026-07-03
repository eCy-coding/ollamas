// vO-free-cloud — API-routed council seats: `provider::model` entries resolve by KEY
// liveness (readyApiProviders from /api/keys/pool), not `ollama list`. Backward compat:
// buildRoster(models) with no ready providers behaves exactly as before.
import { describe, it, expect } from "vitest";
import {
  buildRoster, resolveSeat, parseApiModel, SEAT_SPEC, type SeatSpec,
} from "../bin/lib/council-roster";

describe("parseApiModel — provider::model syntax", () => {
  it("parses an API-routed entry; plain ollama tags return null", () => {
    expect(parseApiModel("groq::llama-3.3-70b-versatile")).toEqual({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(parseApiModel("qwen3-coder:480b-cloud")).toBeNull();
    expect(parseApiModel("hf.co/user/model:tag")).toBeNull();
    expect(parseApiModel("::model")).toBeNull();
    expect(parseApiModel("groq::")).toBeNull();
  });
});

describe("cloud-alt seat — free-tier API fallbacks", () => {
  const spec: SeatSpec = SEAT_SPEC.find((s) => s.capability === "cloud-alt")!;

  it("lists API-routed free-tier models AFTER the ollama-cloud preferences", () => {
    const apiIdx = spec.models.findIndex((m) => parseApiModel(m));
    expect(apiIdx).toBeGreaterThan(0); // ollama tags stay first preference
    expect(spec.models).toContain("groq::llama-3.3-70b-versatile");
  });

  it("no ollama cloud tags pulled + groq key live → seat resolves to the groq entry", () => {
    const seat = resolveSeat(spec, new Set<string>(), new Set(["groq"]));
    expect(seat.model).toBe("groq::llama-3.3-70b-versatile");
    expect(seat.available).toBe(true);
  });

  it("no models and no ready providers → absent (unchanged legacy behavior)", () => {
    const seat = resolveSeat(spec, new Set<string>(), new Set<string>());
    expect(seat.available).toBe(false);
  });

  it("buildRoster threads readyApiProviders; default arg keeps old behavior", () => {
    const withKeys = buildRoster([], ["groq", "cerebras"]);
    const cloudAlt = withKeys.seats.find((s) => s.capability === "cloud-alt")!;
    expect(cloudAlt.available).toBe(true);
    expect(parseApiModel(cloudAlt.model!)).not.toBeNull();

    const withoutKeys = buildRoster([]);
    expect(withoutKeys.seats.find((s) => s.capability === "cloud-alt")!.available).toBe(false);
  });
});

describe("capability-matched API fallbacks — every analysis seat survives an ollama outage", () => {
  // embedding needs the /embed endpoint (chat façade can't serve it) and custom-review is a
  // local fine-tune by definition — both stay local-only. Every OTHER seat must carry ≥1
  // provider::model fallback so a failed `ollama list` (launchd PATH, GPU hiccup) can't
  // collapse the council below full lane coverage while free-tier keys are live.
  const LOCAL_ONLY = new Set(["embedding", "custom-review"]);

  it("every non-local-only seat lists an API-routed fallback AFTER its local tags", () => {
    for (const spec of SEAT_SPEC) {
      if (LOCAL_ONLY.has(spec.capability)) continue;
      const apiIdx = spec.models.findIndex((m) => parseApiModel(m));
      expect(apiIdx, `${spec.capability} needs a provider::model fallback`).toBeGreaterThan(0);
      // local-first: every entry before the first API fallback is a plain tag
      for (const m of spec.models.slice(0, apiIdx)) expect(parseApiModel(m)).toBeNull();
    }
  });

  it("ollama outage + live free-tier keys → full lane coverage, only local-only seats absent", () => {
    const roster = buildRoster([], ["cerebras", "groq", "zai", "github-models"]);
    for (const seat of roster.seats) {
      if (LOCAL_ONLY.has(seat.capability)) continue;
      expect(seat.available, `${seat.capability} should resolve via API fallback`).toBe(true);
    }
    expect(roster.lanesUncovered).toEqual([]);
  });

  it("local tags still win over API fallbacks when ollama answers", () => {
    const roster = buildRoster(["qwen3-coder:30b"], ["cerebras", "groq", "zai", "github-models"]);
    const deepCode = roster.seats.find((s) => s.capability === "deep-code")!;
    expect(deepCode.model).toBe("qwen3-coder:30b");
  });

  it("zero keys + zero models → legacy all-absent behavior unchanged", () => {
    const roster = buildRoster([], []);
    expect(roster.present).toBe(0);
  });
});
