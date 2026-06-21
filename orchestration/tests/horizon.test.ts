import { describe, it, expect } from "vitest";
import {
  sevToNum, normalizeCritic, normalizePanel, normalizeDrift, normalizeBacklog,
  clusterSignals, nextVersionIds, synthesizeHorizon, buildHorizonReport,
  type HorizonSignal,
} from "../bin/lib/horizon";

describe("sevToNum", () => {
  it("string→sayı, sayı→aynen, bilinmeyen→30", () => {
    expect(sevToNum("high")).toBe(80);
    expect(sevToNum("hard")).toBe(80);
    expect(sevToNum("soft")).toBe(20);
    expect(sevToNum(20)).toBe(20);
    expect(sevToNum("???")).toBe(30);
  });
});

describe("normalizers", () => {
  it("critic findings → signal", () => {
    const s = normalizeCritic([{ lane: "orchestration", kind: "coverage-gap:x", detail: "x test'siz", severity: 20 }]);
    expect(s[0]).toMatchObject({ source: "critic", lane: "orchestration", severity: 20 });
    expect(s[0].key).toContain("critic:orchestration");
  });
  it("panel yalnız open not → signal", () => {
    const s = normalizePanel([
      { targetLane: "backend", targetPath: "server/metrics.ts", finding: "obs gap", severity: "high", status: "open" },
      { targetLane: "x", targetPath: "y", finding: "kapalı", severity: "high", status: "adopted" },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ source: "panel", lane: "backend", severity: 80 });
  });
  it("drift yalnız hard → signal", () => {
    const s = normalizeDrift([
      { lane: "frontend", check: "choke-point", actual: "raw fetch", severity: "hard" },
      { lane: "cli", check: "branch-coherence", actual: "x", severity: "soft" },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ source: "drift", lane: "frontend", severity: 80 });
  });
  it("backlog → signal", () => {
    expect(normalizeBacklog([{ lane: "cli", next: "v11 Keychain" }])[0]).toMatchObject({ source: "backlog", lane: "cli" });
  });
});

describe("clusterSignals (dedup + consensus boost)", () => {
  it("aynı key birleşir, severity frekansla artar, source'lar toplanır", () => {
    const sigs: HorizonSignal[] = [
      { source: "critic", lane: "backend", title: "obs gap", severity: 50, key: "k1" },
      { source: "panel", lane: "backend", title: "obs gap", severity: 80, key: "k1" },
      { source: "drift", lane: "frontend", title: "fetch", severity: 80, key: "k2" },
    ];
    const c = clusterSignals(sigs);
    expect(c).toHaveLength(2);
    const k1 = c.find((x) => x.key === "k1")!;
    expect(k1.severity).toBeGreaterThan(80);          // max(80) + consensus boost
    expect(k1.sources.sort()).toEqual(["critic", "panel"]);
    expect(k1.count).toBe(2);
  });
});

describe("nextVersionIds", () => {
  it("startNum'dan ardışık vO id'leri", () => {
    expect(nextVersionIds(12, 3)).toEqual(["vO12", "vO13", "vO14"]);
  });
});

describe("synthesizeHorizon", () => {
  const sigs: HorizonSignal[] = [
    { source: "critic", lane: "backend", title: "obs gap", severity: 50, key: "k1" },
    { source: "panel", lane: "backend", title: "obs gap", severity: 80, key: "k1" },
    { source: "drift", lane: "frontend", title: "raw fetch bypass", severity: 80, key: "k2" },
    { source: "backlog", lane: "cli", title: "v11 Keychain", severity: 40, key: "k3" },
  ];
  it("severity↓ sırala + vO id ata + top-N + source attribution", () => {
    const items = synthesizeHorizon(sigs, 12, 10);
    expect(items[0].ver).toBe("vO12");
    expect(items[0].severity).toBeGreaterThanOrEqual(items[1].severity); // sıralı
    expect(items[0].key === "k1" || items[0].sources.length >= 1).toBe(true);
    expect(items.every((i, idx) => i.ver === `vO${12 + idx}`)).toBe(true); // ardışık
    expect(items.length).toBe(3); // 3 distinct cluster
  });
  it("count sınırı uygulanır", () => {
    expect(synthesizeHorizon(sigs, 12, 2)).toHaveLength(2);
  });
  it("deterministik — aynı girdi aynı çıktı", () => {
    expect(synthesizeHorizon(sigs, 12, 10)).toEqual(synthesizeHorizon(sigs, 12, 10));
  });
});

describe("buildHorizonReport", () => {
  it("vO id + rationale içerir; boşsa temiz mesaj", () => {
    const items = synthesizeHorizon([{ source: "drift", lane: "frontend", title: "raw fetch", severity: 80, key: "k" }], 12, 10);
    const md = buildHorizonReport(items, "2026-06-20T00:00:00Z");
    expect(md).toContain("vO12");
    expect(md).toMatch(/frontend/);
    expect(buildHorizonReport([], "t")).toMatch(/sinyal yok|temiz|✅/i);
  });
});
