import { describe, it, expect } from "vitest";
import {
  tierToCriticality, normalizeFindings, qualityToReqs, dedupe, rankCritical,
  scoreReadiness, topCritical, critRank, CRITICALITY,
  sourceFresh, staleWarning, normalizeFresh, staleFailLanes, guardStaleConduct,
  type Requirement,
} from "../bin/lib/fuse";

describe("critRank + tierToCriticality", () => {
  it("CRITICAL en öncelikli, ROADMAP en az", () => {
    expect(critRank("CRITICAL")).toBe(0);
    expect(critRank("ROADMAP")).toBe(CRITICALITY.length - 1);
  });
  it("RED→CRITICAL, SECURITY→SECURITY, COMPLETENESS→COMPLETENESS", () => {
    expect(tierToCriticality("RED", 100)).toBe("CRITICAL");
    expect(tierToCriticality("SECURITY", 90)).toBe("SECURITY");
    expect(tierToCriticality("COMPLETENESS", 65)).toBe("COMPLETENESS");
  });
  it("bilinmeyen tier → severity ile tahmin", () => {
    expect(tierToCriticality("???", 70)).toBe("COMPLETENESS");
    expect(tierToCriticality("???", 10)).toBe("ROADMAP");
  });
});

describe("normalizeFindings", () => {
  it("Finding → Requirement + source", () => {
    const r = normalizeFindings("critic", [{ tier: "COMPLETENESS", kind: "crit:x", detail: "d", action: "a", severity: 65 }]);
    expect(r[0]).toMatchObject({ criticality: "COMPLETENESS", source: "critic", target: "crit:x", score: 65 });
  });
  it("string severity → sayısal", () => {
    const r = normalizeFindings("dod", [{ tier: "COMPLETENESS", kind: "k", detail: "d", action: "a", severity: "high" }]);
    expect(r[0].score).toBe(65);
  });
});

describe("qualityToReqs", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  const fresh = "2026-06-20T11:50:00Z"; // 10dk
  it("testLast=failed + TAZE testTs → CRITICAL", () => {
    const r = qualityToReqs({ lanes: [{ lane: "backend", tsc: "pass", testLast: "failed", testTs: fresh }] }, 60, now);
    expect(r[0].criticality).toBe("CRITICAL");
    expect(r[0].detail).toMatch(/backend/);
  });
  it("testLast=failed + BAYAT testTs → phantom-critical YOK, STALE uyarı (vO15)", () => {
    const r = qualityToReqs({ lanes: [{ lane: "backend", tsc: "pass", testLast: "failed", testTs: "2026-06-18T12:00:00Z" }] }, 60, now);
    expect(r[0].criticality).toBe("COMPLETENESS");
    expect(r[0].target).toBe("stale-test:backend");
    expect(r.find((x) => x.criticality === "CRITICAL")).toBeUndefined();
  });
  it("tscErrors>0 → CRITICAL (tsc bayatlık-dışı)", () => {
    expect(qualityToReqs({ lanes: [{ lane: "x", tsc: "fail", tscErrors: 3, testLast: "pass" }] }, 60, now)[0].criticality).toBe("CRITICAL");
  });
  it("hepsi pass → req yok", () => {
    expect(qualityToReqs({ lanes: [{ lane: "x", tsc: "pass", tscErrors: 0, testLast: "pass" }] }, 60, now)).toEqual([]);
  });
});

describe("dedupe — aynı target en-yüksek criticality kazanır", () => {
  it("iki analizör aynı target → tek, CRITICAL kazanır, source birleşir", () => {
    const reqs: Requirement[] = [
      { criticality: "COMPLETENESS", source: "dod", target: "dod:gate:backend", detail: "d1", action: "a1", score: 40 },
      { criticality: "CRITICAL", source: "quality", target: "gate:backend", detail: "d2", action: "a2", score: 100 },
    ];
    const d = dedupe(reqs);
    expect(d).toHaveLength(1);
    expect(d[0].criticality).toBe("CRITICAL");
    expect(d[0].source).toMatch(/dod/);
    expect(d[0].source).toMatch(/quality/);
  });
  it("farklı target → ikisi de kalır", () => {
    const reqs: Requirement[] = [
      { criticality: "DRIFT", source: "critic", target: "drift:a", detail: "", action: "", score: 50 },
      { criticality: "STALE", source: "conduct", target: "stale:b", detail: "", action: "", score: 30 },
    ];
    expect(dedupe(reqs)).toHaveLength(2);
  });
});

describe("rankCritical — critical-first", () => {
  it("CRITICAL ilk, ROADMAP son", () => {
    const reqs: Requirement[] = [
      { criticality: "ROADMAP", source: "x", target: "r", detail: "", action: "", score: 10 },
      { criticality: "CRITICAL", source: "y", target: "c", detail: "", action: "", score: 100 },
    ];
    expect(rankCritical(reqs)[0].criticality).toBe("CRITICAL");
  });
  it("topCritical = en kritik", () => {
    const reqs: Requirement[] = [
      { criticality: "STALE", source: "x", target: "s", detail: "", action: "", score: 20 },
      { criticality: "SECURITY", source: "y", target: "sec", detail: "", action: "", score: 90 },
    ];
    expect(topCritical(reqs)?.criticality).toBe("SECURITY");
  });
  it("boş → null", () => {
    expect(topCritical([])).toBeNull();
  });
});

describe("scoreReadiness", () => {
  it("temiz → 100; CRITICAL ağır ceza", () => {
    expect(scoreReadiness([])).toBe(100);
    expect(scoreReadiness([{ criticality: "CRITICAL", source: "", target: "", detail: "", action: "", score: 100 }])).toBe(75);
  });
  it("deterministik", () => {
    const r: Requirement[] = [{ criticality: "DRIFT", source: "", target: "", detail: "", action: "", score: 50 }];
    expect(scoreReadiness(r)).toBe(scoreReadiness(r));
  });
});

describe("vO15 staleness-guard — phantom-critical önle", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  it("sourceFresh: taze→true, bayat→false, geçersiz→false", () => {
    expect(sourceFresh("2026-06-20T11:30:00Z", 60, now)).toBe(true);   // 30dk
    expect(sourceFresh("2026-06-18T12:00:00Z", 60, now)).toBe(false);  // 2 gün
    expect(sourceFresh("", 60, now)).toBe(false);
    expect(sourceFresh(undefined, 60, now)).toBe(false);
  });
  it("staleWarning: COMPLETENESS uyarı + re-run action", () => {
    const w = staleWarning("quality", "2026-06-18T12:00:00Z", "quality.ts");
    expect(w.criticality).toBe("COMPLETENESS");
    expect(w.target).toBe("stale:quality");
    expect(w.action).toMatch(/quality\.ts/);
  });
  it("normalizeFresh: TAZE → findings normal; BAYAT → discard + tek uyarı (phantom-critical YOK)", () => {
    const findings = [{ tier: "RED", kind: "red:backend", detail: "test failed", action: "fix", severity: 100 }];
    const fresh = normalizeFresh("quality", findings, "2026-06-20T11:50:00Z", "quality.ts", 60, now);
    expect(fresh[0].criticality).toBe("CRITICAL"); // taze → RED korunur

    const stale = normalizeFresh("quality", findings, "2026-06-18T12:00:00Z", "quality.ts", 60, now);
    expect(stale).toHaveLength(1);
    expect(stale[0].target).toBe("stale:quality");   // bayat → CRITICAL ÜRETİLMEZ, uyarı
    expect(stale.find((r) => r.criticality === "CRITICAL")).toBeUndefined();
  });
  it("bayat-kaynak + boş findings → hiç uyarı yok (gürültü değil)", () => {
    expect(normalizeFresh("critic", [], "2026-06-18T12:00:00Z", "critic.ts", 60, now)).toEqual([]);
  });
});

describe("vO16 conduct-RED staleness guard", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  const Q = { lanes: [
    { lane: "backend", testLast: "failed", testTs: "2026-06-18T12:00:00Z" }, // bayat-fail
    { lane: "frontend", testLast: "failed", testTs: "2026-06-20T11:50:00Z" }, // taze-fail
    { lane: "cli", testLast: "passed", testTs: "2026-06-20T11:50:00Z" },
  ]};
  it("staleFailLanes: bayat-fail → set'te; taze-fail/passed → değil", () => {
    const s = staleFailLanes(Q, 60, now);
    expect(s.has("backend")).toBe(true);
    expect(s.has("frontend")).toBe(false);
    expect(s.has("cli")).toBe(false);
  });
  it("guardStaleConduct: CRITICAL+stale-lane → COMPLETENESS downgrade; taze-lane CRITICAL korunur", () => {
    const reqs: Requirement[] = [
      { criticality: "CRITICAL", source: "conduct", target: "red:backend", detail: "backend RED", action: "fix", score: 100 },
      { criticality: "CRITICAL", source: "conduct", target: "red:frontend", detail: "frontend RED", action: "fix", score: 100 },
    ];
    const g = guardStaleConduct(reqs, staleFailLanes(Q, 60, now));
    expect(g.find((r) => r.target === "red:backend")?.criticality).toBe("COMPLETENESS"); // bayat → downgrade
    expect(g.find((r) => r.target === "red:frontend")?.criticality).toBe("CRITICAL");    // taze → korunur
  });
  it("stale set boş → değişiklik yok", () => {
    const reqs: Requirement[] = [{ criticality: "CRITICAL", source: "conduct", target: "red:x", detail: "", action: "", score: 100 }];
    expect(guardStaleConduct(reqs, new Set())).toEqual(reqs);
  });
  it("non-CRITICAL → dokunma", () => {
    const reqs: Requirement[] = [{ criticality: "ROADMAP", source: "conduct", target: "next:backend", detail: "", action: "", score: 10 }];
    expect(guardStaleConduct(reqs, new Set(["backend"]))[0].criticality).toBe("ROADMAP");
  });
});
