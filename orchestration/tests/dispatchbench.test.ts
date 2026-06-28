import { describe, it, expect } from "vitest";
import {
  parseDispatchRecords, aggregateDispatch, selectBestForMachine, selectAllMachines,
  assignWorker, buildDispatchPrompt, median, DISPATCH_CORRECT_GATE,
  type DispatchRecord, type FleetWorker,
} from "../bin/lib/dispatchbench";

// ── parseDispatchRecords ─────────────────────────────────────────────────────
describe("parseDispatchRecords — graceful, never throws", () => {
  it("bare array + {records} sarmalı ikisi de parse olur", () => {
    const rows = [{ variant: "a", machine: "mac", correct: true, steps: 3, dupTools: 0, latencyMs: 100, tokS: 40 }];
    expect(parseDispatchRecords(rows)).toHaveLength(1);
    expect(parseDispatchRecords({ records: rows })).toHaveLength(1);
  });
  it("bozuk/eksik-alan satırı atlar, throw etmez", () => {
    const out = parseDispatchRecords([
      { variant: "a", machine: "mac" },          // eksik metrikler → default'lanır, geçerli
      { machine: "mac" },                         // variant yok → atla
      null, 42, "x",                              // çöp → atla
      { variant: "b", machine: "desktop-ert7724", correct: true, steps: 2, dupTools: 1, latencyMs: 50, tokS: 30 },
    ]);
    expect(out.map((r) => r.variant)).toEqual(["a", "b"]);
    expect(out[0].correct).toBe(false); // default
  });
  it("null/garbage girdi → boş dizi", () => {
    expect(parseDispatchRecords(null)).toEqual([]);
    expect(parseDispatchRecords({ nope: 1 })).toEqual([]);
  });
});

describe("median", () => {
  it("tek/çift uzunluk + boş", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
  });
});

// ── aggregateDispatch ────────────────────────────────────────────────────────
const RECORDS: DispatchRecord[] = [
  { variant: "terse", machine: "mac", correct: true, steps: 4, dupTools: 0, latencyMs: 200, tokS: 40 },
  { variant: "terse", machine: "mac", correct: true, steps: 2, dupTools: 0, latencyMs: 100, tokS: 44 },
  { variant: "verbose", machine: "mac", correct: false, steps: 9, dupTools: 3, latencyMs: 900, tokS: 40 },
  { variant: "terse", machine: "desktop-ert7724", correct: true, steps: 3, dupTools: 0, latencyMs: 120, tokS: 30 },
];

describe("aggregateDispatch — per (variant,machine), deterministic", () => {
  const aggs = aggregateDispatch(RECORDS);
  it("3 grup (mac×2 + desktop×1), makine→variant sıralı", () => {
    expect(aggs.map((a) => `${a.machine}|${a.variant}`)).toEqual([
      "desktop-ert7724|terse", "mac|terse", "mac|verbose",
    ]);
  });
  it("correctRatio + median doğru", () => {
    const macTerse = aggs.find((a) => a.machine === "mac" && a.variant === "terse")!;
    expect(macTerse.runs).toBe(2);
    expect(macTerse.correctRatio).toBe(1);
    expect(macTerse.medianSteps).toBe(3); // median(4,2)
    expect(macTerse.medianTokS).toBe(42); // median(40,44)
  });
  it("deterministik (aynı girdi → aynı çıktı)", () => {
    expect(aggregateDispatch(RECORDS)).toEqual(aggs);
  });
});

// ── selection (ordered gate) ─────────────────────────────────────────────────
describe("selectBestForMachine — correctness-gate → efficiency", () => {
  const aggs = aggregateDispatch(RECORDS);
  it("mac: 'verbose' gate-altı elenir, 'terse' seçilir", () => {
    const sel = selectBestForMachine(aggs, "mac");
    expect(sel.variant).toBe("terse");
    expect(sel.correctRatio).toBeGreaterThanOrEqual(DISPATCH_CORRECT_GATE);
  });
  it("veri olmayan makine → variant null + gerekçe", () => {
    const sel = selectBestForMachine(aggs, "nonexistent");
    expect(sel.variant).toBeNull();
    expect(sel.reason).toMatch(/veri yok/);
  });
  it("hiç aday gate geçmezse → null + 'gate geçmedi' gerekçe", () => {
    const allWrong = aggregateDispatch([
      { variant: "x", machine: "mac", correct: false, steps: 1, dupTools: 0, latencyMs: 10, tokS: 50 },
    ]);
    const sel = selectBestForMachine(allWrong, "mac");
    expect(sel.variant).toBeNull();
    expect(sel.reason).toMatch(/gate/);
  });
  it("efficiency tie-break: eşit correct → daha az adım+dup kazanır", () => {
    const aggs2 = aggregateDispatch([
      { variant: "lean", machine: "mac", correct: true, steps: 2, dupTools: 0, latencyMs: 300, tokS: 30 },
      { variant: "fat", machine: "mac", correct: true, steps: 8, dupTools: 2, latencyMs: 100, tokS: 99 },
    ]);
    expect(selectBestForMachine(aggs2, "mac").variant).toBe("lean"); // adım/dup latency'den önce
  });
  it("selectAllMachines daima iki kanonik makineyi içerir", () => {
    const all = selectAllMachines(aggs);
    expect(all.map((m) => m.machine).sort()).toContain("desktop-ert7724");
    expect(all.map((m) => m.machine)).toContain("mac");
  });
});

// ── assignWorker (pure routing) ──────────────────────────────────────────────
const MAC: FleetWorker = { name: "mac", kind: "mac", healthy: true, tokS: 20 };
const DESK: FleetWorker = { name: "desktop-ert7724", kind: "remote", healthy: true, tokS: 40 };

describe("assignWorker — Hybrid routing, deterministic", () => {
  it("host-tool → daima mac", () => {
    expect(assignWorker({ id: "t", kind: "host-tool" }, [MAC, DESK])).toEqual(
      expect.objectContaining({ worker: "mac" }),
    );
  });
  it("host-tool + mac down → atanamaz (null)", () => {
    const r = assignWorker({ id: "t", kind: "host-tool" }, [DESK, { ...MAC, healthy: false }]);
    expect(r.worker).toBeNull();
  });
  it("codegen → en yüksek tok/s remote (desktop)", () => {
    expect(assignWorker({ id: "t", kind: "codegen" }, [MAC, DESK]).worker).toBe("desktop-ert7724");
  });
  it("codegen + remote down → mac substrate failover", () => {
    const r = assignWorker({ id: "t", kind: "codegen" }, [MAC, { ...DESK, healthy: false }]);
    expect(r.worker).toBe("mac");
    expect(r.reason).toMatch(/substrate failover/);
  });
  it("hiç sağlıklı worker yok → null", () => {
    expect(assignWorker({ id: "t", kind: "analysis" }, [{ ...MAC, healthy: false }]).worker).toBeNull();
  });
  it("thrash-guard: mevcut worker hâlâ uygunsa korunur", () => {
    const r = assignWorker({ id: "t", kind: "codegen" }, [MAC, DESK], { current: "mac" });
    expect(r.worker).toBe("mac");
    expect(r.reason).toMatch(/thrash-guard/);
  });
  it("iki remote → tok/s desc, sonra ad tie-break (deterministik)", () => {
    const a: FleetWorker = { name: "a-box", kind: "remote", healthy: true, tokS: 50 };
    const b: FleetWorker = { name: "b-box", kind: "remote", healthy: true, tokS: 50 };
    expect(assignWorker({ id: "t", kind: "codegen" }, [a, b]).worker).toBe("a-box");
  });
});

// ── buildDispatchPrompt ──────────────────────────────────────────────────────
describe("buildDispatchPrompt — portable, evidence-law", () => {
  const md = buildDispatchPrompt({
    ts: "2026-06-28", stale: false,
    machines: selectAllMachines(aggregateDispatch(RECORDS)),
  });
  it("seçili varyant tablosu + routing + choke-point + evidence-law içerir", () => {
    expect(md).toMatch(/DISTRIBUTED DISPATCH/);
    expect(md).toMatch(/desktop-ert7724/);
    expect(md).toMatch(/assignWorker/);
    expect(md).toMatch(/ToolRegistry import YOK/);
    expect(md).toMatch(/verdict===DONE/);
  });
  it("stale=true → STALE uyarısı; stale=false → taze", () => {
    const staleMd = buildDispatchPrompt({ ts: "x", stale: true, machines: [] });
    expect(staleMd).toMatch(/STALE|veri yok/);
    expect(md).toMatch(/Taze ölçüme dayalı/);
  });
});
