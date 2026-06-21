import { describe, it, expect } from "vitest";
import { aggregateBacklog, renderLaneBacklog, renderCrossBacklog, type CritFinding } from "../bin/lib/backlog";

const QUALITY = { redLanes: [{ lane: "backend", detail: "test failed" }] };
const PANEL = [
  { targetLane: "frontend", severity: "high", finding: "choke-point bypass", targetPath: "src/components/X.tsx", solution: "apiClient üzerinden çağır" },
  { targetLane: "backend", severity: "med", finding: "prom-client dashboard yok", targetPath: "server/metrics.ts", solution: "Grafana panel ekle" },
];
const DRIFT = { rows: ["[HARD] `frontend` choke-point · src/components/Y.tsx: raw fetch bypass"] };

describe("aggregateBacklog — cross-lane critical → per-lane (PURE)", () => {
  const map = aggregateBacklog(DRIFT, QUALITY, PANEL);
  it("sahibi lane'e göre gruplar (frontend + backend)", () => {
    expect(Object.keys(map).sort()).toEqual(["backend", "frontend"]);
  });
  it("frontend: panel-high + drift-HARD, severity-DESC sıralı", () => {
    const fe = map.frontend;
    expect(fe.length).toBe(2);
    expect(fe[0].severity).toBeGreaterThanOrEqual(fe[1].severity); // desc
    expect(fe.some((f) => f.source === "drift")).toBe(true);
    expect(fe.some((f) => f.source === "panel")).toBe(true);
  });
  it("backend: quality-RED + panel-med", () => {
    const be = map.backend;
    expect(be.some((f) => f.source === "quality")).toBe(true);
    expect(be.some((f) => /RED|test failed/i.test(f.title))).toBe(true);
  });
  it("deterministik", () => {
    expect(aggregateBacklog(DRIFT, QUALITY, PANEL)).toEqual(map);
  });
  it("boş girdi → boş map (kırılmaz)", () => {
    expect(aggregateBacklog({}, {}, [])).toEqual({});
  });
});

describe("renderLaneBacklog — yapıştır-hazır fix-prompt", () => {
  const map = aggregateBacklog(DRIFT, QUALITY, PANEL);
  it("lane + finding + fix + çalışma-prensibi içerir", () => {
    const md = renderLaneBacklog("frontend", map.frontend);
    expect(md).toContain("frontend");
    expect(md).toMatch(/choke-point|bypass/);
    expect(md).toMatch(/apiClient/);          // fix
    expect(md).toMatch(/TDD|root-cause|gate/); // çalışma prensibi footer
  });
  it("boş → temiz mesajı", () => {
    expect(renderLaneBacklog("cli", [])).toMatch(/temiz|critical bulgu yok/i);
  });
});

describe("renderCrossBacklog", () => {
  it("tüm lane section'ları + özet", () => {
    const md = renderCrossBacklog(aggregateBacklog(DRIFT, QUALITY, PANEL));
    expect(md).toContain("frontend");
    expect(md).toContain("backend");
    expect(md).toMatch(/CROSS|BACKLOG|critical/i);
  });
});
