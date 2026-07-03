import { describe, it, expect } from "vitest";
import {
  classify, prioritize, reconcile, buildConductorReport, tierRank, TIERS, freshRedLanes,
  type ClassifyInput, type Finding,
} from "../bin/lib/conduct";

const baseInput = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  lanes: [], adoptionViolations: [], depgraphMissing: [], driftCount: 0,
  benchRegressions: [], redLanes: [], idleThresholdH: 6, ...over,
});

describe("tierRank — öncelik sırası", () => {
  it("RED < SECURITY < ... < ROADMAP (küçük = öncelikli)", () => {
    expect(tierRank("RED")).toBe(0);
    expect(tierRank("SECURITY")).toBeLessThan(tierRank("CONTRACT"));
    expect(tierRank("ROADMAP")).toBe(TIERS.length - 1);
  });
});

describe("classify — sinyal → Finding tier", () => {
  it("lisans ihlali → SECURITY", () => {
    const f = classify(baseInput({ adoptionViolations: [{ repo: "evil/gpl", reason: "GPL+ADOPT" }] }));
    expect(f[0].tier).toBe("SECURITY");
  });
  it("API gap → CONTRACT", () => {
    const f = classify(baseInput({ depgraphMissing: ["/api/foo"] }));
    expect(f[0].tier).toBe("CONTRACT");
    expect(f[0].detail).toMatch(/api\/foo/);
  });
  it("idle lane > eşik → STALE; eşik altı → yok", () => {
    const stale = classify(baseInput({ lanes: [{ lane: "frontend", idle: true, ageHours: 10, dirtyFiles: 0, roadmapNext: "" }] }));
    expect(stale.find((x) => x.tier === "STALE")).toBeTruthy();
    const fresh = classify(baseInput({ lanes: [{ lane: "frontend", idle: true, ageHours: 2, dirtyFiles: 0, roadmapNext: "" }] }));
    expect(fresh.find((x) => x.tier === "STALE")).toBeUndefined();
  });
  it("roadmap next → ROADMAP", () => {
    const f = classify(baseInput({ lanes: [{ lane: "cli", idle: false, ageHours: 1, dirtyFiles: 0, roadmapNext: "v11 Keychain" }] }));
    expect(f.find((x) => x.tier === "ROADMAP")?.detail).toMatch(/v11 Keychain/);
  });
  it("bench regression → REGRESSION", () => {
    const f = classify(baseInput({ benchRegressions: [{ model: "qwen3:8b", dropPct: 15 }] }));
    expect(f[0].tier).toBe("REGRESSION");
  });
});

describe("COMPLETENESS tier — vO10-12 öz-denetim wiring (critic/dod merge)", () => {
  it("COMPLETENESS TIERS'te: RED'den sonra, STALE'den önce (yarım-iş acil ama gate-altı)", () => {
    expect(TIERS).toContain("COMPLETENESS");
    expect(tierRank("RED")).toBeLessThan(tierRank("COMPLETENESS"));
    expect(tierRank("COMPLETENESS")).toBeLessThan(tierRank("STALE"));
  });
  it("prioritize: RED COMPLETENESS'i yener; RED yoksa COMPLETENESS (yarım-iş) seçilir", () => {
    const comp: Finding = { tier: "COMPLETENESS", lane: "orchestration", kind: "dod:code-without-test:x", detail: "x test'siz — yarım iş", action: "test ekle", severity: 65 };
    const red: Finding = { tier: "RED", lane: "backend", kind: "red:backend", detail: "test failed", action: "düzelt", severity: 100 };
    expect(prioritize([comp, red])?.tier).toBe("RED");
    expect(prioritize([comp])?.kind).toBe("dod:code-without-test:x");
  });
});

describe("prioritize — TEK eylem (0 manuel seçim)", () => {
  it("RED her şeyi ezer (ROADMAP varken bile)", () => {
    const f = classify(baseInput({
      redLanes: [{ lane: "backend", detail: "test 3 fail" }],
      lanes: [{ lane: "cli", idle: false, ageHours: 1, dirtyFiles: 0, roadmapNext: "v11" }],
      adoptionViolations: [{ repo: "x/gpl", reason: "GPL" }],
    }));
    expect(prioritize(f)?.tier).toBe("RED");
  });
  it("RED yokken SECURITY seçilir", () => {
    const f = classify(baseInput({
      adoptionViolations: [{ repo: "x/gpl", reason: "GPL" }],
      lanes: [{ lane: "cli", idle: true, ageHours: 99, dirtyFiles: 0, roadmapNext: "v11" }],
    }));
    expect(prioritize(f)?.tier).toBe("SECURITY");
  });
  it("eşit tier → severity desc → lexicographic lane (deterministik)", () => {
    const findings: Finding[] = [
      { tier: "STALE", lane: "zeta", kind: "stale:zeta", detail: "", action: "", severity: 40 },
      { tier: "STALE", lane: "alpha", kind: "stale:alpha", detail: "", action: "", severity: 40 },
    ];
    expect(prioritize(findings)?.lane).toBe("alpha");
  });
  it("boş → null (stabil)", () => {
    expect(prioritize([])).toBeNull();
  });
});

describe("reconcile — idempotent delta (k8s desired-vs-actual)", () => {
  const cur: Finding[] = [
    { tier: "ROADMAP", lane: "cli", kind: "next:cli", detail: "", action: "", severity: 10 },
    { tier: "STALE", lane: "frontend", kind: "stale:frontend", detail: "", action: "", severity: 30 },
  ];
  it("yeni/çözülen/süregelen ayrışır", () => {
    const d = reconcile(["next:cli", "lic:old"], cur);
    expect(d.added).toContain("stale:frontend");
    expect(d.resolved).toContain("lic:old");
    expect(d.persistent).toContain("next:cli");
  });
  it("aynı → boş delta (idempotent)", () => {
    const d = reconcile(["next:cli", "stale:frontend"], cur);
    expect(d.added).toHaveLength(0);
    expect(d.resolved).toHaveLength(0);
    expect(d.persistent).toHaveLength(2);
  });
});

describe("buildConductorReport", () => {
  const findings: Finding[] = [
    { tier: "SECURITY", lane: "global", kind: "lic:x", detail: "GPL ihlal", action: "ref-only yap", severity: 90 },
    { tier: "ROADMAP", lane: "cli", kind: "next:cli", detail: "v11 sıradaki", action: "planla cli", severity: 10 },
  ];
  it("durum + 🎯 tek-eylem + bulgular + prompt", () => {
    const r = buildConductorReport({
      ts: "2026-06-20T00:00:00Z", summary: "lane tablosu",
      findings, action: prioritize(findings), delta: { added: ["lic:x"], resolved: [], persistent: [] },
      workingPrompt: "MODEL qwen3-coder:30b num_ctx=8192",
    });
    expect(r).toMatch(/SIRADAKI TEK EYLEM/);
    expect(r).toMatch(/SECURITY/);          // en öncelikli seçildi
    expect(r).toMatch(/ref-only yap/);
    expect(r).toMatch(/qwen3-coder:30b/);   // optimal prompt gömülü
    expect(r).toMatch(/Tüm bulgular/);
  });
  it("eylem yok → stabil mesajı", () => {
    const r = buildConductorReport({ ts: "T", summary: "s", findings: [], action: null, delta: { added: [], resolved: [], persistent: [] }, workingPrompt: "p" });
    expect(r).toMatch(/temiz|stabil|eylem gerekmez/i);
  });
});

describe("vO41 freshRedLanes — bayat QUALITY.redLanes yutulmaz (phantom-CRITICAL kökü)", () => {
  const now = Date.parse("2026-07-03T12:00:00Z");
  const red = [{ lane: "integration/v17-core", detail: "tsc 18 hata" }];
  it("dosya-ts taze → redLanes geçer", () => {
    expect(freshRedLanes({ ts: "2026-07-03T11:50:00Z", redLanes: red }, 60, now)).toEqual(red);
  });
  it("dosya-ts bayat → boş (fuse staleWarning zaten üretir)", () => {
    expect(freshRedLanes({ ts: "2026-06-24T08:39:50.000Z", redLanes: red }, 60, now)).toEqual([]);
  });
  it("ts yok/geçersiz → boş (güvenli taraf)", () => {
    expect(freshRedLanes({ redLanes: red }, 60, now)).toEqual([]);
    expect(freshRedLanes(null, 60, now)).toEqual([]);
  });
  it("redLanes dizi değil → boş", () => {
    expect(freshRedLanes({ ts: "2026-07-03T11:50:00Z", redLanes: "x" }, 60, now)).toEqual([]);
  });
});
