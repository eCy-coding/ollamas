import { describe, it, expect } from "vitest";
import { parseVersion, parseRoadmap, parseGotchas, parseMission, buildRoleAnswer, type RoleInputs } from "../cli/lib/role";

// Pure parsers + renderer — no I/O, no git. The live gather() reads real files; here
// we feed fixtures so the self-update guarantee (no hardcoded stage) is provable.

describe("parseVersion", () => {
  it("extracts the VERSION literal from index.ts", () => {
    expect(parseVersion('const VERSION = "11.0.0";')).toBe("11.0.0");
  });
  it("returns ? when absent", () => {
    expect(parseVersion("no version here")).toBe("?");
  });
});

describe("parseRoadmap", () => {
  const md = `
| Ver | Tema | Çekirdek | Durum |
|---|---|---|---|
| **v10** | Self-update + plugin | x | ✅ DONE |
| **v11** | Keychain + secrets v2 | y | ✅ DONE |
| **v12** | Node-SEA binary | z | ▶ NEXT |
`;
  it("shipped = the LAST ✅ DONE row", () => {
    expect(parseRoadmap(md).shipped).toEqual({ ver: "v11", theme: "Keychain + secrets v2" });
  });
  it("next = the first ▶ NEXT row", () => {
    expect(parseRoadmap(md).next).toEqual({ ver: "v12", theme: "Node-SEA binary" });
  });
  it("null when no rows match", () => {
    const r = parseRoadmap("| nothing | here |");
    expect(r.shipped).toBeNull();
    expect(r.next).toBeNull();
  });
});

describe("parseGotchas", () => {
  const md = `## v11
### N-024 · keychain per-user
### N-025 · argv-leak on write
### N-026 · source-agnostic seam`;
  it("returns the last N gotcha headings, stripped", () => {
    expect(parseGotchas(md, 2)).toEqual(["N-025 · argv-leak on write", "N-026 · source-agnostic seam"]);
  });
  it("empty when none", () => {
    expect(parseGotchas("no gotchas")).toEqual([]);
  });
});

describe("parseMission", () => {
  it("extracts the §0 first paragraph", () => {
    const md = `## §0 — North Star\nollamas için tek birleşik CLI inşa et.\nMac+iOS verimli.\n\n## §1`;
    expect(parseMission(md)).toContain("tek birleşik CLI");
  });
  it("falls back when §0 absent", () => {
    expect(parseMission("no section")).toContain("CLI");
  });
});

describe("buildRoleAnswer (self-updating — stage comes from inputs, never hardcoded)", () => {
  const base: RoleInputs = {
    version: "11.0.0",
    shipped: { ver: "v11", theme: "Keychain" },
    next: { ver: "v12", theme: "Node-SEA" },
    branch: "feat/cli-v2-clean",
    lastCommit: "f7510e3 v11 phase6",
    gotchas: ["N-026 · source-agnostic seam"],
    mission: "tek birleşik ollamas CLI",
  };
  it("renders all the template sections", () => {
    const out = buildRoleAnswer(base);
    for (const s of ["Görev", "Sınırlar", "Çalışma akışı", "GÜNCEL AŞAMA", "gotcha", "Kapanış"]) {
      expect(out).toContain(s);
    }
  });
  it("reflects the live stage (v11 shipped → v12 next)", () => {
    const out = buildRoleAnswer(base);
    expect(out).toContain("v11");
    expect(out).toContain("v12");
    expect(out).toContain("feat/cli-v2-clean");
  });
  it("SELF-UPDATE: evolve inputs → evolved output (v12 shipped, v13 next, no stale v11)", () => {
    const evolved = buildRoleAnswer({ ...base, shipped: { ver: "v12", theme: "Node-SEA" }, next: { ver: "v13", theme: "Completions v2" } });
    expect(evolved).toContain("v13");
    expect(evolved).toContain("Completions v2");
    expect(evolved).not.toMatch(/shipped:.*v11/);
  });
  it("graceful — null shipped/next render as —", () => {
    const out = buildRoleAnswer({ ...base, shipped: null, next: null });
    expect(out).toContain("—");
  });
});
