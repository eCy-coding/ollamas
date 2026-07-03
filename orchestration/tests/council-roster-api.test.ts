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
