// vP5 — provider-smoke saf çekirdek: source eşleşmesi + gate verdict'i.
// Canlı e2e'nin kendisi bin/provider-smoke.ts koşusudur (ERR-TUNNEL-003: unit ≠ canlı kanıt);
// burada yalnız saf karar mantığı test edilir.
import { describe, it, expect } from "vitest";
import { sourceMatches, smokeVerdict, type SmokeResult } from "../bin/provider-smoke";

const R = (step: SmokeResult["step"], provider: string, ok: boolean): SmokeResult =>
  ({ step, provider, ok, hit: ok, source: ok ? `cloud:${provider}` : "", ms: 1, detail: "" });

describe("sourceMatches — pinned yanıt kaynağı", () => {
  it("cloud:<id> önekini ve düz id'yi kabul eder", () => {
    expect(sourceMatches("cerebras", "cloud:cerebras")).toBe(true);
    expect(sourceMatches("ollama-local", "ollama-local")).toBe(true);
    expect(sourceMatches("fleet", "fleet:mac")).toBe(true);
  });
  it("farklı provider'dan gelen yanıtı eşleştirmez (fallback tespiti)", () => {
    expect(sourceMatches("gemini", "ollama-local")).toBe(false);
    expect(sourceMatches("gemini", "cloud:cerebras")).toBe(false);
  });
});

// hit=true → kendi source'undan; hit=false ama ok=true → 429-fallthrough (canlı fallback kanıtı).
const P = (provider: string, ok: boolean, hit: boolean): SmokeResult =>
  ({ step: "pinned", provider, ok, hit, source: hit ? `cloud:${provider}` : ok ? "fleet:mac" : "", ms: 1, detail: "" });

describe("smokeVerdict — gate kuralları (429-fallthrough = kanıt, hata değil)", () => {
  const term = { ...R("terminal", "ollama-local", true), hit: true };

  it("≥2 farklı cloud hit + hepsi yanıtlı + terminal → GO", () => {
    const v = smokeVerdict([P("cerebras", true, true), P("groq", true, true), P("zai", true, false), term]);
    expect(v.go).toBe(true);
  });
  it("pinned 429-fallthrough (ok ama hit değil) gate'i DÜŞÜRMEZ — canlı fallback kanıtı sayılır", () => {
    const v = smokeVerdict([P("cerebras", true, true), P("groq", true, true), P("zai", true, false), term]);
    expect(v.summary).toMatch(/fallthrough|düşüş|fallback/i);
  });
  it("yanıtsız pinned (ok=false) → NO-GO", () => {
    expect(smokeVerdict([P("cerebras", true, true), P("groq", false, false), P("zai", true, true), term]).go).toBe(false);
  });
  it("cloud hit <2 → NO-GO (tek provider'la 'combine' iddiası olmaz)", () => {
    expect(smokeVerdict([P("cerebras", true, true), P("zai", true, false), term]).go).toBe(false);
  });
  it("terminal FAIL → NO-GO (lokal son durak olmazsa zincir sonsuz değil)", () => {
    expect(smokeVerdict([P("cerebras", true, true), P("groq", true, true), { ...R("terminal", "ollama-local", false), hit: false }]).go).toBe(false);
  });
  it("hiç pinned yoksa (key yok / pool erişilemez) → NO-GO, dürüst", () => {
    expect(smokeVerdict([term]).go).toBe(false);
  });
  it("sentetik fallback (keyless) koşulduysa PASS zorunlu", () => {
    const base = [P("cerebras", true, true), P("groq", true, true), term];
    expect(smokeVerdict([...base, { ...R("fallback", "vllm", false), hit: false }]).go).toBe(false);
    expect(smokeVerdict([...base, { ...R("fallback", "vllm", true), hit: false }]).go).toBe(true);
  });
});
