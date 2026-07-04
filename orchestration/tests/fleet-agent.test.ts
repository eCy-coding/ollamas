// fleet-agent.test.ts — the pure decision seams bin/fleet-agent.ts composes: full-jitter backoff
// bounds (the transient-retry wait), transient-error classification (retry vs fail-fast fork), and
// dispatchTarget provider routing (the vO39 root-fix: cloud tags → ollama-cloud, `provider::model`
// API workers → bare model + catalog provider). gpu-lock is covered by its own suite — not repeated.
import { describe, it, expect } from "vitest";
import { fullJitterDelay, isTransient } from "../bin/lib/backoff";
import { dispatchTarget } from "../bin/lib/chrome-probe";

describe("fullJitterDelay — bounds of the retry wait (delay = rand × min(cap, base·2^attempt))", () => {
  const BASE = 2000, CAP = 60_000; // fleet-agent's transient-retry parameters

  it("deterministic with an injected rand: floor(rand × exp)", () => {
    expect(fullJitterDelay(0, BASE, CAP, () => 0.5)).toBe(1000);   // 0.5 × 2000
    expect(fullJitterDelay(2, BASE, CAP, () => 0.25)).toBe(2000);  // 0.25 × 8000
  });
  it("lower bound: rand→0 gives 0 (full jitter includes an immediate retry)", () => {
    for (const a of [0, 1, 5]) expect(fullJitterDelay(a, BASE, CAP, () => 0)).toBe(0);
  });
  it("upper bound: strictly below base·2^attempt while uncapped", () => {
    const almostOne = () => 1 - 1e-12;
    expect(fullJitterDelay(0, BASE, CAP, almostOne)).toBeLessThan(2000);
    expect(fullJitterDelay(3, BASE, CAP, almostOne)).toBeLessThan(16_000);
    expect(fullJitterDelay(3, BASE, CAP, almostOne)).toBeGreaterThan(15_000); // exp actually grows
  });
  it("cap bounds the exponential: huge attempt never exceeds capMs", () => {
    expect(fullJitterDelay(30, BASE, CAP, () => 1 - 1e-12)).toBeLessThan(CAP);
    expect(fullJitterDelay(30, BASE, CAP, () => 0.5)).toBe(CAP / 2); // exp latched at cap
  });
  it("negative / fractional attempts are floored to a sane exponent", () => {
    expect(fullJitterDelay(-3, BASE, CAP, () => 0.5)).toBe(1000);   // clamped to attempt 0
    expect(fullJitterDelay(1.9, BASE, CAP, () => 0.5)).toBe(2000);  // floor(1.9)=1 → exp 4000
  });
  it("default Math.random stays inside [0, exp) across samples (no thundering herd alignment)", () => {
    for (let i = 0; i < 200; i++) {
      const d = fullJitterDelay(2, BASE, CAP);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(8000);
    }
  });
});

describe("isTransient — retry vs fail-fast classification", () => {
  it("network/timeout/throttle/5xx signatures are transient (fleet-agent backs off + retries)", () => {
    const transient = [
      "connect ETIMEDOUT 100.64.0.1:11434", "read ECONNRESET", "ECONNREFUSED", "socket hang up",
      "fetch failed", "request timed out", "429 Too Many Requests", "rate limit exceeded",
      "503 Service Unavailable", "upstream returned 502",
    ];
    for (const m of transient) expect(isTransient(m), m).toBe(true);
  });
  it("accepts Error objects (fleet-agent passes r.err blobs and thrown errors alike)", () => {
    expect(isTransient(new Error("network error while dispatching"))).toBe(true);
    expect(isTransient(new Error("model not found"))).toBe(false);
  });
  it("non-transient errors fail fast — no wasted GPU-queue turns", () => {
    const permanent = ["ENOENT: no such file", "invalid api key", "model requires more memory", "SyntaxError: Unexpected token"];
    for (const m of permanent) expect(isTransient(m), m).toBe(false);
  });
  it("null/undefined/empty → not transient (honest ERROR, no retry loop)", () => {
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient("")).toBe(false);
  });
});

describe("dispatchTarget — provider routing for the fleet model entry (vO39 / T2-F3)", () => {
  it("`provider::model` API worker → catalog provider + BARE model id (prefixed form 404s)", () => {
    expect(dispatchTarget("groq::llama-3.3-70b-versatile")).toEqual({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(dispatchTarget("cerebras::qwen-3-coder-480b")).toEqual({ provider: "cerebras", model: "qwen-3-coder-480b" });
  });
  it("gemini tag → gemini-cli provider, tag kept", () => {
    expect(dispatchTarget("gemini-2.5-flash")).toEqual({ provider: "gemini-cli", model: "gemini-2.5-flash" });
  });
  it("cloud ollama tag → ollama-cloud (the root-fix: never the local daemon), tag kept", () => {
    expect(dispatchTarget("gpt-oss:120b-cloud")).toEqual({ provider: "ollama-cloud", model: "gpt-oss:120b-cloud" });
    expect(dispatchTarget("qwen3:8b-cloud")).toEqual({ provider: "ollama-cloud", model: "qwen3:8b-cloud" });
  });
  it("plain local tag → ollama-local, tag kept", () => {
    expect(dispatchTarget("qwen3:8b")).toEqual({ provider: "ollama-local", model: "qwen3:8b" });
    expect(dispatchTarget("hf.co/org/model:Q4")).toEqual({ provider: "ollama-local", model: "hf.co/org/model:Q4" });
  });
  it("malformed `::` entries fall back to tag routing (both halves must be non-empty)", () => {
    expect(dispatchTarget("::llama")).toEqual({ provider: "ollama-local", model: "::llama" });
    expect(dispatchTarget("groq::")).toEqual({ provider: "ollama-local", model: "groq::" });
  });
});
