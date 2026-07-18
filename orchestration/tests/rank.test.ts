import { describe, it, expect } from "vitest";
import { severityWeight, boostSeverity, dedupe, resolveDiscourse, buildReport } from "../bin/lib/rank";
import type { DiagnosticNote } from "../bin/lib/note";

function note(over: Partial<DiagnosticNote>): DiagnosticNote {
  return {
    id: "p-l-1", persona: "backend", targetLane: "backend", targetPath: "x", severity: "med",
    confidence: "detected", finding: "f", evidence: [], minRefs: 2, status: "open",
    debate: { challenges: [], support: [], verdict: "" }, source: "detected", ...over,
  };
}

describe("severityWeight / boostSeverity", () => {
  it("ağırlık sırası blocker>high>med>low>info", () => {
    expect(severityWeight("blocker")).toBeGreaterThan(severityWeight("high"));
    expect(severityWeight("low")).toBeGreaterThan(severityWeight("info"));
  });
  // orchestration-rank (catalog): her Severity → tam ağırlık eşlemesi (ORDER index+1 sözleşmesi).
  // Attribution: claude-conductor (model-blocked escalation — 30b test yerine unused export üretti).
  it("her Severity kendi ağırlığına eşlenir (info=1 … blocker=5)", () => {
    expect(severityWeight("info")).toBe(1);
    expect(severityWeight("low")).toBe(2);
    expect(severityWeight("med")).toBe(3);
    expect(severityWeight("high")).toBe(4);
    expect(severityWeight("blocker")).toBe(5);
  });
  it("boost bir seviye yükseltir, blocker'da tavanlanır", () => {
    expect(boostSeverity("med")).toBe("high");
    expect(boostSeverity("blocker")).toBe("blocker");
  });
});

describe("dedupe — çapraz-persona", () => {
  it("aynı bulguyu 2 persona bildirince tek not + consensus boost", () => {
    const a = note({ id: "backend-x-1", persona: "backend", targetPath: "p", finding: "orphan dir" });
    const b = note({ id: "fullstack-x-1", persona: "fullstack", targetPath: "p", finding: "Orphan Dir!!" });
    const r = dedupe([a, b]);
    expect(r.notes.length).toBe(1);
    expect(r.duplicatesMerged).toBe(1);
    expect(r.consensusBoosted).toContain(r.notes[0].id);
    expect(r.notes[0].severity).toBe("high"); // med→high boost
    expect(r.notes[0].consensus!.sort()).toEqual(["backend", "fullstack"]);
  });
  it("tek persona iki kez (aynı bulgu) consensus VERMEZ (farklı persona şartı)", () => {
    const a = note({ id: "backend-x-1", persona: "backend", targetPath: "p", finding: "dup" });
    const b = note({ id: "backend-x-2", persona: "backend", targetPath: "p", finding: "dup" });
    const r = dedupe([a, b]);
    expect(r.notes.length).toBe(1);
    expect(r.consensusBoosted).toEqual([]);
    expect(r.notes[0].severity).toBe("med");
  });
  it("farklı bulgular korunur", () => {
    expect(dedupe([note({ targetPath: "a", finding: "x" }), note({ targetPath: "b", finding: "y" })]).notes.length).toBe(2);
  });
});

describe("resolveDiscourse", () => {
  it("≥2 challenge + 0 support → unresolved", () => {
    const n = note({ id: "n1", debate: { challenges: ["c1", "c2"], support: [], verdict: "" } });
    const r = resolveDiscourse([n]);
    expect(r.unresolvedDebates).toContain("n1");
  });
  it("support varsa unresolved değil", () => {
    const n = note({ id: "n1", debate: { challenges: ["c1", "c2"], support: ["s1"], verdict: "" } });
    expect(resolveDiscourse([n]).unresolvedDebates).toEqual([]);
  });
});

describe("buildReport — aggregation", () => {
  const notes = [
    note({ id: "backend-backend-1", persona: "backend", targetLane: "backend", severity: "high", targetPath: "a", finding: "f1", targetHash: "abc" }),
    note({ id: "frontend-frontend-1", persona: "frontend", targetLane: "frontend", severity: "low", targetPath: "b", finding: "f2", targetHash: "abc",
      solution: { summary: "s", refs: [{ repo: "r", license: "MIT", url: "u", kind: "copy" }, { repo: "r2", license: "MIT", url: "u2", kind: "idea" }] } }),
  ];
  it("personaCoverage + byLane + ranked (severity↓) + refDeficit + stale", () => {
    const rep = buildReport(notes, { ts: "T", staleIds: ["backend-backend-1"] });
    expect(rep.personaCoverage.backend).toBe(1);
    expect(rep.byLane.frontend).toBe(1);
    expect(rep.ranked[0]).toBe("backend-backend-1"); // high önce
    expect(rep.refDeficit).toContain("backend-backend-1"); // solution yok
    expect(rep.refDeficit).not.toContain("frontend-frontend-1"); // 2 ref var
    expect(rep.stale).toEqual(["backend-backend-1"]);
    expect(rep.totals.bySeverity.high).toBe(1);
    expect(rep.totals.open).toBe(2);
  });
  it("uncovered: tespit-yeteneği OLMAYAN (target'sız) persona'ları listeler — taranıp-temiz değil (coverage-critic)", () => {
    const rep = buildReport(notes, { ts: "T" });
    // vO4.1 sonrası 8 personanın hepsinde scan target var → uncovered boş.
    // "Taranıp temiz" (fullstack/integrations 0 bulgu) uncovered SAYILMAZ — yeteneği var.
    expect(rep.uncovered).toEqual([]);
    expect(rep.uncovered).not.toContain("fullstack");
    expect(rep.uncovered).not.toContain("integrations");
  });
});
