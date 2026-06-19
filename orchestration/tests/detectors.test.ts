import { describe, it, expect } from "vitest";
import {
  nameVersionMismatch, emptyFile, orphanDir, unreferencedArtifact, wiredNoConsumer,
} from "../bin/lib/detectors";

describe("nameVersionMismatch", () => {
  it("placeholder name + 0.0.0 sürüm → 2 bulgu", () => {
    const out = nameVersionMismatch(JSON.stringify({ name: "react-example", version: "0.0.0" }), "package.json");
    expect(out.length).toBe(2);
    expect(out.some((f) => /name/i.test(f.finding))).toBe(true);
    expect(out.some((f) => /version|0\.0\.0/i.test(f.finding))).toBe(true);
  });
  it("gerçek ad + semver → bulgu yok", () => {
    expect(nameVersionMismatch(JSON.stringify({ name: "ollamas", version: "1.9.0" }), "package.json")).toEqual([]);
  });
  it("bozuk JSON → bulgu yok (kırılmaz)", () => {
    expect(nameVersionMismatch("{bad", "package.json")).toEqual([]);
  });
});

describe("emptyFile", () => {
  it("boş içerik → bulgu", () => {
    const out = emptyFile("project_cortex.md", "   \n\n  ");
    expect(out.length).toBe(1);
    expect(out[0].evidence[0].fact).toMatch(/boş|empty/i);
  });
  it("eşik altı içerik (yalnız başlık) → bulgu", () => {
    const out = emptyFile("project_cortex.md", "# Title\n", 20);
    expect(out.length).toBe(1);
  });
  it("dolu içerik → bulgu yok", () => {
    expect(emptyFile("x.md", "uzun anlamlı içerik ".repeat(10))).toEqual([]);
  });
});

describe("orphanDir", () => {
  it("inbound ref 0 → orphan bulgu", () => {
    const out = orphanDir("backend/mesh", 0);
    expect(out.length).toBe(1);
    expect(out[0].finding).toMatch(/orphan|kullanılm|import yok/i);
  });
  it("inbound ref >0 → bulgu yok", () => {
    expect(orphanDir("backend/mesh", 3)).toEqual([]);
  });
});

describe("unreferencedArtifact", () => {
  it("ref 0 → bulgu", () => {
    const out = unreferencedArtifact("logSeyir.jsonl", 0);
    expect(out.length).toBe(1);
  });
  it("ref >0 → bulgu yok", () => {
    expect(unreferencedArtifact("logSeyir.jsonl", 2)).toEqual([]);
  });
});

describe("wiredNoConsumer", () => {
  it("üretici var + tüketici 0 → bulgu (prom-client dashboard yok)", () => {
    const out = wiredNoConsumer("prom-client", 5, 0, "server/metrics.ts");
    expect(out.length).toBe(1);
    expect(out[0].finding).toMatch(/dashboard|tüket|consumer/i);
  });
  it("üretici 0 → bulgu yok (bağlı değil zaten)", () => {
    expect(wiredNoConsumer("prom-client", 0, 0, "server/metrics.ts")).toEqual([]);
  });
  it("tüketici var → bulgu yok", () => {
    expect(wiredNoConsumer("prom-client", 5, 3, "server/metrics.ts")).toEqual([]);
  });
});
