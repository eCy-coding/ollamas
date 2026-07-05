import { describe, it, expect } from "vitest";
import {
  resolveConductor, resolveJoker, rosterModels, shouldFailover, applyFailover, maybeFailover, DEFAULT_JOKER,
} from "../bin/lib/joker";
import { emptyOrchestraState } from "../bin/lib/orchestra-fsm";

describe("resolveConductor — benchmark selection", () => {
  it("reads selection.model", () => {
    expect(resolveConductor({ selection: { model: "qwen3-coder:30b" } })).toBe("qwen3-coder:30b");
  });
  it("falls back on missing/garbage", () => {
    expect(resolveConductor(null)).toBe("qwen3-coder:30b");
    expect(resolveConductor({ selection: {} })).toBe("qwen3-coder:30b");
    expect(resolveConductor({ selection: { model: "" } }, "fb")).toBe("fb");
  });
});

describe("rosterModels — available seats", () => {
  it("extracts available model names, drops unavailable/empty", () => {
    const roster = { seats: [
      { model: "a", available: true },
      { model: "b", available: false },
      { model: "", available: true },
      { model: "c" },
    ] };
    expect(rosterModels(roster)).toEqual(["a", "c"]);
  });
  it("empty on garbage", () => { expect(rosterModels(null)).toEqual([]); });
});

describe("resolveJoker — standby pick", () => {
  it("prefers DEFAULT_JOKER when healthy and distinct", () => {
    expect(resolveJoker([DEFAULT_JOKER, "x"], "qwen3-coder:30b")).toBe(DEFAULT_JOKER);
  });
  it("skips DEFAULT_JOKER when it IS the conductor → next healthy roster model", () => {
    const roster = { seats: [{ model: "codestral:22b", available: true }] };
    expect(resolveJoker([DEFAULT_JOKER, "codestral:22b"], DEFAULT_JOKER, roster)).toBe("codestral:22b");
  });
  it("returns '' when no healthy alternative exists (no thrash)", () => {
    expect(resolveJoker(["qwen3-coder:30b"], "qwen3-coder:30b")).toBe("");
    expect(resolveJoker([], "qwen3-coder:30b")).toBe("");
  });
});

describe("shouldFailover — policy", () => {
  it("only when conductor unhealthy AND distinct healthy joker exists", () => {
    expect(shouldFailover(false, "big", "qwen3:8b")).toBe(true);
    expect(shouldFailover(true, "big", "qwen3:8b")).toBe(false);   // healthy → no swap
    expect(shouldFailover(false, "big", "")).toBe(false);          // no joker → no swap
    expect(shouldFailover(false, "big", "big")).toBe(false);       // joker == conductor → no swap
  });
});

describe("applyFailover / maybeFailover", () => {
  it("swaps model, bumps counter, logs [FAILOVER]", () => {
    const s0 = emptyOrchestraState("qwen3-coder:30b");
    const s1 = applyFailover(s0, "qwen3:8b", "2026-01-01T00:00:00Z");
    expect(s1.conductor_model).toBe("qwen3:8b");
    expect(s1.failover_count).toBe(1);
    expect(s1.history.at(-1)!.note).toContain("[FAILOVER] qwen3-coder:30b→qwen3:8b");
  });
  it("maybeFailover: healthy conductor → no swap", () => {
    const s0 = emptyOrchestraState("qwen3-coder:30b");
    const r = maybeFailover(s0, true, [DEFAULT_JOKER], "t");
    expect(r.swapped).toBe(false);
    expect(r.state.conductor_model).toBe("qwen3-coder:30b");
  });
  it("maybeFailover: down conductor + healthy joker → swap", () => {
    const s0 = emptyOrchestraState("qwen3-coder:30b");
    const r = maybeFailover(s0, false, [DEFAULT_JOKER], "t");
    expect(r.swapped).toBe(true);
    expect(r.state.conductor_model).toBe(DEFAULT_JOKER);
    expect(r.state.failover_count).toBe(1);
  });
  it("maybeFailover: down conductor + NO healthy alternative → no thrash", () => {
    const s0 = emptyOrchestraState("qwen3-coder:30b");
    const r = maybeFailover(s0, false, ["qwen3-coder:30b"], "t");
    expect(r.swapped).toBe(false);
    expect(r.state.failover_count).toBe(0);
  });
});
