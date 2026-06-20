/**
 * quality.test.ts — vO9 Quality-Gate Roll-Up saf çekirdek (parse + rollup + tablo).
 */
import { describe, it, expect } from "vitest";
import {
  parseTscResult, parseLastRun, rollup, toQualityTable, type LaneQuality,
} from "../bin/lib/quality";

const lq = (p: Partial<LaneQuality>): LaneQuality => ({
  lane: "x", branch: "feat/x-v1", tsc: "pass", tscErrors: 0,
  testLast: "unknown", testTs: "", testStale: false, dirty: 0, ...p,
});

describe("parseTscResult — tsc --noEmit çıktısı", () => {
  it("exit 0 → ok, 0 hata", () => {
    expect(parseTscResult(0, "")).toEqual({ ok: true, errorCount: 0 });
  });
  it("exit≠0 + 'Found N errors' → fail + sayı", () => {
    expect(parseTscResult(2, "x.ts(3,5): error TS2304\nFound 3 errors in 1 file.")).toEqual({ ok: false, errorCount: 3 });
  });
  it("exit≠0 sayı-yok → 'error TS' satır sayar (min 1)", () => {
    expect(parseTscResult(1, "a.ts: error TS1\nb.ts: error TS2").errorCount).toBe(2);
    expect(parseTscResult(1, "garbage").errorCount).toBe(1);
  });
});

describe("parseLastRun — vitest .last-run.json", () => {
  it("passed/failed", () => {
    expect(parseLastRun('{"status":"passed","failedTests":[]}').status).toBe("passed");
    expect(parseLastRun('{"status":"failed","failedTests":[]}').status).toBe("failed");
  });
  it("bozuk/boş → unknown", () => {
    expect(parseLastRun("not json").status).toBe("unknown");
    expect(parseLastRun("{}").status).toBe("unknown");
  });
});

describe("rollup — conduct-uyumlu redLanes + sınıflama", () => {
  const qs = [
    lq({ lane: "backend", tsc: "fail", tscErrors: 4, testLast: "failed" }),
    lq({ lane: "frontend", tsc: "pass", testLast: "passed" }),
    lq({ lane: "cli", tsc: "pass", testLast: "unknown" }),
    lq({ lane: "scripts", tsc: "skip", testLast: "unknown" }),
  ];
  const r = rollup(qs);
  it("tsc-fail VEYA test-failed → reds + redLanes {lane,detail}", () => {
    expect(r.reds.map((q) => q.lane)).toEqual(["backend"]);
    expect(r.redLanes).toEqual([{ lane: "backend", detail: expect.stringMatching(/tsc.*4|test/i) }]);
  });
  it("tsc-pass + test-passed → green", () => {
    expect(r.greens.map((q) => q.lane)).toContain("frontend");
  });
  it("test bilinmiyor (tsc-pass/skip) → unknown, red DEĞİL", () => {
    expect(r.unknowns.map((q) => q.lane).sort()).toEqual(["cli", "scripts"]);
    expect(r.redLanes.map((x) => x.lane)).not.toContain("cli");
  });
});

describe("toQualityTable — markdown matris", () => {
  it("lane + tsc/test sütunları", () => {
    const t = toQualityTable([lq({ lane: "backend", tsc: "fail", tscErrors: 4, testLast: "failed" })]);
    expect(t).toContain("backend");
    expect(t).toMatch(/tsc/i);
    expect(t).toMatch(/✗|fail|🔴/i);
  });
});
