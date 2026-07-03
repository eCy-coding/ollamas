import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rollover, canDispatch, remaining, recordSuccess, recordExhausted,
  pickVendor, defaultLimitFor, isVendorExhausted,
  loadBudget, saveBudget, guardVendor, noteVendorOutcome,
  type VendorState, type BudgetFile,
} from "../bin/lib/vendor-budget";

const v = (date: string, used: number, limit = 20): VendorState => ({ date, used, limit });

// ── isVendorExhausted: reliable cross-vendor rate/quota detector (NOT gemini-specific wording) ─────────
describe("isVendorExhausted", () => {
  it("catches an HTTP 429 status by number", () => {
    expect(isVendorExhausted('{"code":429,"message":"Too Many Requests"}')).toBe(true);
    expect(isVendorExhausted("groq API error 429")).toBe(true);
  });
  it("catches vendor wordings that omit the literal 429 or 'quota'", () => {
    expect(isVendorExhausted("Rate limit reached for model llama-3.3-70b")).toBe(true); // groq
    expect(isVendorExhausted("Too Many Requests")).toBe(true);                           // generic
    expect(isVendorExhausted("insufficient_quota")).toBe(true);                          // openai-style
    expect(isVendorExhausted("You exceeded your current requests limit")).toBe(true);    // cerebras/zai
    expect(isVendorExhausted("RESOURCE_EXHAUSTED")).toBe(true);                          // gemini/google
  });
  it("does NOT latch on a transient 5xx overload (that is retry-worthy, not exhausted)", () => {
    expect(isVendorExhausted("503 Service Unavailable — model is overloaded")).toBe(false);
    expect(isVendorExhausted("502 Bad Gateway")).toBe(false);
    expect(isVendorExhausted("500 internal error")).toBe(false);
  });
  it("is false on empty / unrelated errors", () => {
    expect(isVendorExhausted("")).toBe(false);
    expect(isVendorExhausted("ECONNREFUSED")).toBe(false);
    expect(isVendorExhausted("invalid model name")).toBe(false);
  });
});

// ── pure per-vendor state (shared shape with gemini-quota) ────────────────────────────────────────────
describe("rollover", () => {
  it("resets used=0 when the day changes (keeps limit)", () => {
    expect(rollover(v("2026-07-02", 20, 30), "2026-07-03")).toEqual({ date: "2026-07-03", used: 0, limit: 30 });
  });
  it("keeps state on the same day", () => {
    expect(rollover(v("2026-07-03", 5), "2026-07-03")).toEqual(v("2026-07-03", 5));
  });
});

describe("canDispatch / remaining", () => {
  it("allows under the limit, blocks at the limit", () => {
    expect(canDispatch(v("2026-07-03", 19), "2026-07-03")).toBe(true);
    expect(canDispatch(v("2026-07-03", 20), "2026-07-03")).toBe(false);
    expect(remaining(v("2026-07-03", 19), "2026-07-03")).toBe(1);
    expect(remaining(v("2026-07-03", 20), "2026-07-03")).toBe(0);
  });
  it("a stale exhausted day rolls over → allowed again tomorrow", () => {
    expect(canDispatch(v("2026-07-02", 20), "2026-07-03")).toBe(true);
    expect(remaining(v("2026-07-02", 20), "2026-07-03")).toBe(20);
  });
});

describe("recordSuccess / recordExhausted", () => {
  it("recordSuccess increments used (rolls over first)", () => {
    expect(recordSuccess(v("2026-07-03", 4), "2026-07-03")).toEqual(v("2026-07-03", 5));
    expect(recordSuccess(v("2026-07-02", 20), "2026-07-03")).toEqual(v("2026-07-03", 1));
  });
  it("recordExhausted latches used≥limit (429), never lowers an over-count", () => {
    expect(recordExhausted(v("2026-07-03", 3), "2026-07-03")).toEqual(v("2026-07-03", 20));
    expect(canDispatch(recordExhausted(v("2026-07-03", 3), "2026-07-03"), "2026-07-03")).toBe(false);
    expect(recordExhausted(v("2026-07-03", 25), "2026-07-03").used).toBe(25);
  });
});

// ── value/availability-aware selection ────────────────────────────────────────────────────────────────
describe("pickVendor", () => {
  const today = "2026-07-03";
  it("picks the candidate with the most remaining budget", () => {
    const b: BudgetFile = { gemini: v(today, 18), groq: v(today, 5), cerebras: v(today, 10) };
    expect(pickVendor(["gemini", "groq", "cerebras"], b, today)).toBe("groq"); // 15 left
  });
  it("skips exhausted vendors", () => {
    const b: BudgetFile = { gemini: v(today, 20), groq: v(today, 19) };
    expect(pickVendor(["gemini", "groq"], b, today)).toBe("groq");
  });
  it("returns null when every candidate is exhausted", () => {
    const b: BudgetFile = { gemini: v(today, 20), groq: v(today, 20) };
    expect(pickVendor(["gemini", "groq"], b, today)).toBeNull();
  });
  it("tie-break honors the preference order", () => {
    const b: BudgetFile = { groq: v(today, 5), cerebras: v(today, 5) }; // equal remaining
    expect(pickVendor(["groq", "cerebras"], b, today, ["cerebras", "groq"])).toBe("cerebras");
    expect(pickVendor(["groq", "cerebras"], b, today, ["groq", "cerebras"])).toBe("groq");
  });
  it("an unknown vendor (no state) uses defaultLimitFor and is available", () => {
    const b: BudgetFile = { gemini: v(today, 20) };
    expect(pickVendor(["gemini", "zai"], b, today)).toBe("zai"); // zai fresh → full budget
  });
  it("rolls a stale exhausted candidate over before picking", () => {
    const b: BudgetFile = { groq: v("2026-07-02", 20) };
    expect(pickVendor(["groq"], b, today)).toBe("groq");
  });
});

// ── defaultLimitFor ───────────────────────────────────────────────────────────────────────────────────
describe("defaultLimitFor", () => {
  afterEach(() => { delete process.env.GROQ_DAILY_LIMIT; delete process.env.ZAI_DAILY_LIMIT; });
  it("uses the env override (floored) when valid", () => {
    process.env.GROQ_DAILY_LIMIT = "7.9";
    expect(defaultLimitFor("groq")).toBe(7);
  });
  it("ignores a non-positive / non-numeric override", () => {
    process.env.ZAI_DAILY_LIMIT = "-3";
    expect(defaultLimitFor("zai")).toBeGreaterThan(0);
  });
  it("falls back to a positive table default for known + unknown vendors", () => {
    expect(defaultLimitFor("gemini")).toBe(20);
    expect(defaultLimitFor("groq")).toBeGreaterThan(0);
    expect(defaultLimitFor("totally-unknown")).toBeGreaterThan(0);
  });
});

// ── thin IO round-trip + sibling safety ───────────────────────────────────────────────────────────────
describe("IO: load / save / guardVendor / noteVendorOutcome", () => {
  let dir = "";
  const path = () => join(dir, "vendor-budget.json");
  const setup = () => { dir = mkdtempSync(join(tmpdir(), "vb-")); return path(); };
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

  it("save → load round-trips", () => {
    const p = setup();
    const b: BudgetFile = { groq: { date: "2026-07-03", used: 3, limit: 20 } };
    saveBudget(p, b);
    expect(loadBudget(p)).toEqual(b);
  });
  it("absent or corrupt file loads as {}", () => {
    const p = setup();
    expect(loadBudget(p)).toEqual({});
    writeFileSync(p, "}{ not json");
    expect(loadBudget(p)).toEqual({});
  });
  it("guardVendor allows a fresh vendor and reports remaining", () => {
    const p = setup();
    const g = guardVendor(p, "groq", "2026-07-03");
    expect(g.allowed).toBe(true);
    expect(g.state.used).toBe(0);
  });
  it("guardVendor blocks an exhausted vendor", () => {
    const p = setup();
    saveBudget(p, { groq: { date: "2026-07-03", used: 20, limit: 20 } });
    expect(guardVendor(p, "groq", "2026-07-03").allowed).toBe(false);
  });
  it("noteVendorOutcome persists one vendor without clobbering siblings", () => {
    const p = setup();
    saveBudget(p, { gemini: { date: "2026-07-03", used: 7, limit: 20 } });
    noteVendorOutcome(p, "groq", "success", "2026-07-03");
    const after = loadBudget(p);
    expect(after.gemini).toEqual({ date: "2026-07-03", used: 7, limit: 20 }); // untouched
    expect(after.groq!.used).toBe(1);
  });
  it("noteVendorOutcome exhausted latches the vendor to its limit", () => {
    const p = setup();
    noteVendorOutcome(p, "cerebras", "exhausted", "2026-07-03", 30);
    const st = loadBudget(p).cerebras!;
    expect(st.used).toBe(st.limit);
    expect(canDispatch(st, "2026-07-03")).toBe(false);
  });
});
