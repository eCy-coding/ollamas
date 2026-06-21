import { describe, it, expect } from "vitest";
import { renderReport, computeStale, mergeNotes } from "../bin/panel";
import { buildReport } from "../bin/lib/rank";
import type { DiagnosticNote } from "../bin/lib/note";

function note(over: Partial<DiagnosticNote>): DiagnosticNote {
  return {
    id: "p-l-1", persona: "backend", targetLane: "backend", targetPath: "x", severity: "med",
    confidence: "detected", finding: "f", evidence: [], minRefs: 2, status: "open",
    debate: { challenges: [], support: [], verdict: "" }, source: "detected", ...over,
  };
}

describe("computeStale", () => {
  it("targetHash != current HEAD → stale", () => {
    const ns = [note({ id: "a", targetHash: "old123" }), note({ id: "b", targetHash: "head99" })];
    expect(computeStale(ns, "head99")).toEqual(["a"]);
  });
  it("targetHash yok → stale değil", () => {
    expect(computeStale([note({ id: "a", targetHash: undefined })], "h")).toEqual([]);
  });
});

describe("mergeNotes — detected + authored birleştir", () => {
  it("aynı id'de authored detected'i ezer (insan çözümü kazanır)", () => {
    const det = note({ id: "backend-backend-1", source: "detected", solution: undefined });
    const auth = note({ id: "backend-backend-1", source: "authored", solution: { summary: "fix", refs: [] } });
    const m = mergeNotes([det], [auth]);
    expect(m.length).toBe(1);
    expect(m[0].source).toBe("authored");
    expect(m[0].solution?.summary).toBe("fix");
  });
  it("eşleşmeyen authored not eklenir", () => {
    const m = mergeNotes([note({ id: "a" })], [note({ id: "b", source: "authored" })]);
    expect(m.length).toBe(2);
  });
});

describe("renderReport — deterministik markdown", () => {
  const notes = [
    note({ id: "backend-backend-1", persona: "backend", severity: "high", finding: "orphan mesh", targetPath: "backend/mesh" }),
    note({ id: "frontend-frontend-1", persona: "frontend", severity: "low", finding: "a11y gap", targetPath: "src/App.tsx",
      solution: { summary: "axe ekle", refs: [{ repo: "r", license: "MIT", url: "u", kind: "copy" }, { repo: "r2", license: "MIT", url: "u2", kind: "idea" }] } }),
  ];
  const rep = buildReport(notes, { ts: "2026-06-20T00:00:00Z", staleIds: [], duplicatesMerged: 0, consensusBoosted: [], unresolvedDebates: [] });
  const md = renderReport(rep, notes);
  it("başlık + ts + ranked tablo + refDeficit bölümü içerir", () => {
    expect(md).toContain("# PANEL_REPORT");
    expect(md).toContain("2026-06-20T00:00:00Z");
    expect(md).toContain("backend-backend-1");
    expect(md).toContain("orphan mesh");
    expect(md).toMatch(/refDeficit|kaynak yetersiz/i);
    expect(md).toContain("backend-backend-1"); // solution yok → refDeficit listesinde
  });
  it("ranked sırası high önce (severity↓)", () => {
    const iHigh = md.indexOf("backend-backend-1");
    const iLow = md.indexOf("frontend-frontend-1");
    expect(iHigh).toBeGreaterThan(-1);
    expect(iHigh).toBeLessThan(iLow);
  });
});
