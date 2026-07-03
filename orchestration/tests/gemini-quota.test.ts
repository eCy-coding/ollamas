import { describe, it, expect } from "vitest";
import { rollover, canDispatch, remaining, recordSuccess, recordExhausted, type QuotaState } from "../bin/lib/gemini-quota";

const s = (date: string, used: number, limit = 20): QuotaState => ({ date, used, limit });

describe("rollover", () => {
  it("resets used=0 when the day changes", () => {
    expect(rollover(s("2026-07-02", 20), "2026-07-03")).toEqual({ date: "2026-07-03", used: 0, limit: 20 });
  });
  it("keeps state on the same day", () => {
    expect(rollover(s("2026-07-03", 5), "2026-07-03")).toEqual(s("2026-07-03", 5));
  });
});

describe("canDispatch / remaining", () => {
  it("allows while under the limit", () => {
    expect(canDispatch(s("2026-07-03", 19), "2026-07-03")).toBe(true);
    expect(remaining(s("2026-07-03", 19), "2026-07-03")).toBe(1);
  });
  it("blocks at the limit", () => {
    expect(canDispatch(s("2026-07-03", 20), "2026-07-03")).toBe(false);
    expect(remaining(s("2026-07-03", 20), "2026-07-03")).toBe(0);
  });
  it("a stale exhausted day rolls over → allowed again tomorrow", () => {
    expect(canDispatch(s("2026-07-02", 20), "2026-07-03")).toBe(true);
    expect(remaining(s("2026-07-02", 20), "2026-07-03")).toBe(20);
  });
});

describe("recordSuccess", () => {
  it("increments used", () => {
    expect(recordSuccess(s("2026-07-03", 4), "2026-07-03")).toEqual(s("2026-07-03", 5));
  });
  it("resets then counts 1 on a new day", () => {
    expect(recordSuccess(s("2026-07-02", 20), "2026-07-03")).toEqual(s("2026-07-03", 1));
  });
});

describe("recordExhausted (429 latch)", () => {
  it("latches the day to the limit even if the counter under-estimated", () => {
    expect(recordExhausted(s("2026-07-03", 3), "2026-07-03")).toEqual(s("2026-07-03", 20));
    expect(canDispatch(recordExhausted(s("2026-07-03", 3), "2026-07-03"), "2026-07-03")).toBe(false);
  });
  it("never lowers a used count above the limit", () => {
    expect(recordExhausted(s("2026-07-03", 25), "2026-07-03").used).toBe(25);
  });
});
