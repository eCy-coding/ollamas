import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rollover, canDispatch, remaining, recordSuccess, recordExhausted,
  defaultLimit, loadQuota, saveQuota, guardQuota, noteOutcome, todayKey,
  type QuotaState,
} from "../bin/lib/gemini-quota";

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

// ── IO layer (state file in a tmp dir; `today` injected → no Date.now flakiness) ──────────────────────

const TODAY = "2026-07-04";
const YESTERDAY = "2026-07-03";
const dirs: string[] = [];
function tmpQuotaFile(): string {
  const d = mkdtempSync(join(tmpdir(), "gemini-quota-test-"));
  dirs.push(d);
  return join(d, "gemini-quota.json");
}
afterEach(() => {
  while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* gone */ } }
  delete process.env.GEMINI_DAILY_LIMIT;
});

describe("defaultLimit", () => {
  it("falls back to the gemini table default (20) without an env override", () => {
    delete process.env.GEMINI_DAILY_LIMIT;
    expect(defaultLimit()).toBe(20);
  });
  it("honors GEMINI_DAILY_LIMIT (floored)", () => {
    process.env.GEMINI_DAILY_LIMIT = "7.9";
    expect(defaultLimit()).toBe(7);
  });
  it("ignores non-numeric / non-positive overrides", () => {
    process.env.GEMINI_DAILY_LIMIT = "not-a-number";
    expect(defaultLimit()).toBe(20);
    process.env.GEMINI_DAILY_LIMIT = "0";
    expect(defaultLimit()).toBe(20);
    process.env.GEMINI_DAILY_LIMIT = "-3";
    expect(defaultLimit()).toBe(20);
  });
});

describe("loadQuota", () => {
  it("absent file → fresh state at the given limit", () => {
    const q = loadQuota(tmpQuotaFile(), 5);
    expect(q.used).toBe(0);
    expect(q.limit).toBe(5);
    expect(q.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("corrupt JSON → fresh state (no throw)", () => {
    const f = tmpQuotaFile();
    writeFileSync(f, "{broken json");
    const q = loadQuota(f, 9);
    expect(q.used).toBe(0);
    expect(q.limit).toBe(9);
  });
  it("JSON missing the required fields → fresh state", () => {
    const f = tmpQuotaFile();
    writeFileSync(f, JSON.stringify({ foo: "not a quota" }));
    expect(loadQuota(f, 4).used).toBe(0);
  });
  it("valid file is returned verbatim", () => {
    const f = tmpQuotaFile();
    writeFileSync(f, JSON.stringify({ date: TODAY, used: 3, limit: 10 }));
    expect(loadQuota(f, 99)).toEqual({ date: TODAY, used: 3, limit: 10 });
  });
  it("missing limit field → parameter limit is used", () => {
    const f = tmpQuotaFile();
    writeFileSync(f, JSON.stringify({ date: TODAY, used: 2 }));
    expect(loadQuota(f, 15)).toEqual({ date: TODAY, used: 2, limit: 15 });
  });
});

describe("saveQuota", () => {
  it("round-trips through load", () => {
    const f = tmpQuotaFile();
    const q: QuotaState = { date: TODAY, used: 7, limit: 20 };
    saveQuota(f, q);
    expect(loadQuota(f)).toEqual(q);
  });
  it("creates missing parent directories (best-effort mkdir -p)", () => {
    const base = mkdtempSync(join(tmpdir(), "gemini-quota-test-"));
    dirs.push(base);
    const f = join(base, "a", "b", "q.json");
    saveQuota(f, { date: TODAY, used: 1, limit: 20 });
    expect(existsSync(f)).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8")).used).toBe(1);
  });
});

describe("guardQuota (pre-flight gate)", () => {
  it("fresh state → allowed, msg reports the remaining budget", () => {
    const g = guardQuota(tmpQuotaFile(), TODAY, 20);
    expect(g.allowed).toBe(true);
    expect(g.state).toEqual({ date: TODAY, used: 0, limit: 20 });
    expect(g.msg).toContain("0/20");
    expect(g.msg).toContain("20 left");
  });
  it("used === limit → exhausted, allowed=false", () => {
    const f = tmpQuotaFile();
    saveQuota(f, { date: TODAY, used: 20, limit: 20 });
    const g = guardQuota(f, TODAY, 20);
    expect(g.allowed).toBe(false);
    expect(g.msg).toContain("exhausted");
  });
  it("day-rollover: yesterday's exhausted state resets today → allowed", () => {
    const f = tmpQuotaFile();
    saveQuota(f, { date: YESTERDAY, used: 20, limit: 20 });
    const g = guardQuota(f, TODAY, 20);
    expect(g.allowed).toBe(true);
    expect(g.state).toEqual({ date: TODAY, used: 0, limit: 20 });
  });
});

describe("noteOutcome (outcome accounting)", () => {
  it("success → used+1 and PERSISTED", () => {
    const f = tmpQuotaFile();
    const s1 = noteOutcome(f, "success", TODAY, 20);
    expect(s1).toEqual({ date: TODAY, used: 1, limit: 20 });
    const s2 = noteOutcome(f, "success", TODAY, 20);
    expect(s2.used).toBe(2);
    expect(loadQuota(f)).toEqual(s2); // disk == memory
  });
  it("exhausted → latches the day (used=limit); guard blocks afterwards", () => {
    const f = tmpQuotaFile();
    noteOutcome(f, "success", TODAY, 20);
    const q = noteOutcome(f, "exhausted", TODAY, 20);
    expect(q.used).toBe(20);
    expect(guardQuota(f, TODAY, 20).allowed).toBe(false);
  });
  it("success over a stale date rolls over first, then counts 1", () => {
    const f = tmpQuotaFile();
    saveQuota(f, { date: YESTERDAY, used: 19, limit: 20 });
    expect(noteOutcome(f, "success", TODAY, 20)).toEqual({ date: TODAY, used: 1, limit: 20 });
  });
});

describe("todayKey (re-export)", () => {
  it("YYYY-MM-DD in UTC, deterministic with an injected Date", () => {
    expect(todayKey(new Date("2026-07-04T12:34:56Z"))).toBe("2026-07-04");
    expect(todayKey(new Date("2026-01-01T23:59:59.999Z"))).toBe("2026-01-01");
  });
});
