import { describe, it, expect } from "vitest";
import { laneDepMap, detectVersionDrift, toDriftTable, type LaneDeps } from "../bin/lib/drift";

// ── laneDepMap: package.json → {name: range} (deps + devDeps) ─────────────────
describe("laneDepMap", () => {
  it("dependencies + devDependencies birleştirir", () => {
    const pkg = JSON.stringify({
      dependencies: { react: "^18.2.0", express: "4.21.0" },
      devDependencies: { vite: "^5.0.0", typescript: "~5.4.0" },
    });
    expect(laneDepMap(pkg)).toEqual({ react: "^18.2.0", express: "4.21.0", vite: "^5.0.0", typescript: "~5.4.0" });
  });
  it("bozuk/boş JSON → boş obje (hatasız)", () => {
    expect(laneDepMap("")).toEqual({});
    expect(laneDepMap("nope")).toEqual({});
    expect(laneDepMap("{}")).toEqual({});
  });
});

// ── detectVersionDrift: aynı dep lane'ler arası farklı range → drift ──────────
describe("detectVersionDrift", () => {
  const lanes: LaneDeps[] = [
    { lane: "frontend", deps: { react: "^18.2.0", vite: "^5.0.0", typescript: "~5.4.0" } },
    { lane: "backend", deps: { react: "^17.0.2", typescript: "~5.4.0", express: "4.21.0" } },
    { lane: "cli", deps: { typescript: "~5.4.0" } },
  ];
  const rows = detectVersionDrift(lanes);

  it("react 3 lane'de 2 farklı range → drifted", () => {
    const react = rows.find(r => r.name === "react")!;
    expect(react.drifted).toBe(true);
    expect(react.pins).toHaveLength(2); // frontend ^18, backend ^17
  });
  it("typescript 3 lane'de aynı range → NOT drifted", () => {
    const ts = rows.find(r => r.name === "typescript")!;
    expect(ts.drifted).toBe(false);
    expect(ts.pins).toHaveLength(3);
  });
  it("tek lane'de görülen dep (express/vite) → drifted=false", () => {
    expect(rows.find(r => r.name === "express")!.drifted).toBe(false);
    expect(rows.find(r => r.name === "vite")!.drifted).toBe(false);
  });
  it("rows isimce sıralı + drifted'ler önce gelir (rapor önceliği)", () => {
    const driftedNames = rows.filter(r => r.drifted).map(r => r.name);
    expect(driftedNames).toEqual(["react"]);
    expect(rows[0].name).toBe("react"); // drifted ilk
  });
  it("lane yoksa boş", () => { expect(detectVersionDrift([])).toEqual([]); });
});

// ── toDriftTable: yalnız drifted satırları markdown tablo ─────────────────────
describe("toDriftTable", () => {
  it("drifted satırı her lane'in pin'iyle yazar", () => {
    const rows = detectVersionDrift([
      { lane: "frontend", deps: { react: "^18.2.0" } },
      { lane: "backend", deps: { react: "^17.0.2" } },
    ]);
    const tbl = toDriftTable(rows);
    expect(tbl).toMatch(/react/);
    expect(tbl).toMatch(/\^18\.2\.0/);
    expect(tbl).toMatch(/\^17\.0\.2/);
    expect(tbl).toMatch(/frontend/);
  });
  it("drift yoksa temiz mesaj", () => {
    const rows = detectVersionDrift([{ lane: "a", deps: { x: "1.0.0" } }]);
    expect(toDriftTable(rows)).toMatch(/drift yok|✅/i);
  });
});
