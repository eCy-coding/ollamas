import { describe, it, expect } from "vitest";
import { snapshotOf, diffSnapshots, renderTrend, type Snapshot } from "../bin/lib/trend";
import type { DiagnosticNote } from "../bin/lib/note";

function note(over: Partial<DiagnosticNote>): DiagnosticNote {
  return {
    id: "p-l-1", persona: "backend", targetLane: "backend", targetPath: "x", severity: "med",
    confidence: "detected", finding: "f", evidence: [], minRefs: 2, status: "open",
    debate: { challenges: [], support: [], verdict: "" }, source: "detected", ...over,
  };
}

describe("snapshotOf", () => {
  it("kompakt snapshot: ts/head + key+severity (tüm not değil)", () => {
    const s = snapshotOf([note({ id: "backend-backend-1", targetPath: "a", finding: "orphan" })], "T", "abc123");
    expect(s.ts).toBe("T");
    expect(s.head).toBe("abc123");
    expect(s.keys.length).toBe(1);
    expect(s.keys[0].severity).toBe("med");
    expect(s.keys[0].key).toContain("a");
    // kompakt: evidence/solution taşımaz
    expect(JSON.stringify(s)).not.toContain("evidence");
  });
});

describe("diffSnapshots", () => {
  const prev: Snapshot = snapshotOf([
    note({ targetPath: "a", finding: "f1", severity: "med" }),
    note({ targetPath: "b", finding: "f2", severity: "low" }),
  ], "T1", "h1");

  it("new: curr'da var prev'de yok", () => {
    const curr = snapshotOf([
      note({ targetPath: "a", finding: "f1", severity: "med" }),
      note({ targetPath: "c", finding: "f3", severity: "high" }),
    ], "T2", "h2");
    const d = diffSnapshots(prev, curr);
    expect(d.new.map((x) => x.key).some((k) => k.includes("c"))).toBe(true);
    expect(d.new.length).toBe(1);
  });

  it("resolved: prev'de var curr'da yok", () => {
    const curr = snapshotOf([note({ targetPath: "a", finding: "f1", severity: "med" })], "T2", "h2");
    const d = diffSnapshots(prev, curr);
    expect(d.resolved.some((x) => x.key.includes("b"))).toBe(true);
    expect(d.resolved.length).toBe(1);
  });

  it("regressed: aynı key severity↑", () => {
    const curr = snapshotOf([
      note({ targetPath: "a", finding: "f1", severity: "high" }), // med→high
      note({ targetPath: "b", finding: "f2", severity: "low" }),
    ], "T2", "h2");
    const d = diffSnapshots(prev, curr);
    expect(d.regressed.some((x) => x.key.includes("a"))).toBe(true);
    expect(d.regressed[0].from).toBe("med");
    expect(d.regressed[0].to).toBe("high");
  });

  it("improved: aynı key severity↓", () => {
    const curr = snapshotOf([
      note({ targetPath: "a", finding: "f1", severity: "low" }), // med→low
      note({ targetPath: "b", finding: "f2", severity: "low" }),
    ], "T2", "h2");
    const d = diffSnapshots(prev, curr);
    expect(d.improved.some((x) => x.key.includes("a"))).toBe(true);
  });

  it("persistent: aynı key aynı severity", () => {
    const curr = snapshotOf([
      note({ targetPath: "a", finding: "f1", severity: "med" }),
      note({ targetPath: "b", finding: "f2", severity: "low" }),
    ], "T2", "h2");
    const d = diffSnapshots(prev, curr);
    expect(d.persistent.length).toBe(2);
    expect(d.new.length).toBe(0);
    expect(d.resolved.length).toBe(0);
  });

  it("ilk çalışma (prev boş) → hepsi new, 0 resolved", () => {
    const curr = snapshotOf([note({ targetPath: "a", finding: "f1" })], "T2", "h2");
    const d = diffSnapshots({ ts: "", head: "", keys: [] }, curr);
    expect(d.new.length).toBe(1);
    expect(d.resolved.length).toBe(0);
  });

  it("id-churn: id değişse de key sabit → idempotent (0 new/0 resolved)", () => {
    // Aynı içerik, FARKLI id (scan yeniden numaralandı).
    const a = snapshotOf([note({ id: "backend-backend-1", targetPath: "a", finding: "orphan dir" })], "T1", "h1");
    const b = snapshotOf([note({ id: "backend-backend-7", targetPath: "a", finding: "Orphan Dir!!" })], "T2", "h2");
    const d = diffSnapshots(a, b);
    expect(d.new.length).toBe(0);
    expect(d.resolved.length).toBe(0);
    expect(d.persistent.length).toBe(1);
  });
});

describe("renderTrend", () => {
  it("delta markdown bölümü üretir (sayılar + başlık)", () => {
    const prev = snapshotOf([note({ targetPath: "b", finding: "f2" })], "T1", "h1");
    const curr = snapshotOf([note({ targetPath: "a", finding: "f1", severity: "high" })], "T2", "h2");
    const md = renderTrend(diffSnapshots(prev, curr));
    expect(md).toMatch(/Trend/i);
    expect(md).toMatch(/new|yeni/i);
    expect(md).toMatch(/resolved|çözül/i);
  });
  it("ilk çalışma → baseline notu", () => {
    const md = renderTrend(diffSnapshots({ ts: "", head: "", keys: [] }, snapshotOf([note({})], "T", "h")));
    expect(md).toMatch(/baseline|ilk/i);
  });
});
