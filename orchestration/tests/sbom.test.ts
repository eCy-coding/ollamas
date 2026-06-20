import { describe, it, expect } from "vitest";
import { parseSyftSbom, auditLaneDeps } from "../bin/lib/sbom";

// ── parseSyftSbom: anchore/syft `-o json` (Apache-2.0) çıktısını tüket ────────
describe("parseSyftSbom", () => {
  it("artifacts[].licenses (value | spdxExpression) → düz {name,version,license}", () => {
    const json = JSON.stringify({
      artifacts: [
        { name: "left-pad", version: "1.3.0", licenses: [{ value: "MIT" }] },
        { name: "gpl-lib", version: "2.0.0", licenses: [{ spdxExpression: "GPL-3.0" }] },
        { name: "nolic", version: "0.1.0", licenses: [] },
      ],
    });
    expect(parseSyftSbom(json)).toEqual([
      { name: "left-pad", version: "1.3.0", license: "MIT" },
      { name: "gpl-lib", version: "2.0.0", license: "GPL-3.0" },
      { name: "nolic", version: "0.1.0", license: "" },
    ]);
  });
  it("bozuk/boş JSON → boş dizi (hatasız, gate kırılmaz)", () => {
    expect(parseSyftSbom("")).toEqual([]);
    expect(parseSyftSbom("not json")).toEqual([]);
    expect(parseSyftSbom("{}")).toEqual([]);
  });
});

// ── auditLaneDeps: lane package.json runtime dep lisans denetimi ──────────────
describe("auditLaneDeps (licenses.ts classifyLicense REUSE)", () => {
  const pkg = JSON.stringify({
    dependencies: { "gpl-lib": "^2.0.0", express: "^4.0.0" },
    devDependencies: { vitest: "^1.0.0" }, // dev → denetlenmez (runtime contamination yok)
  });
  const sbom = [
    { name: "gpl-lib", version: "2.0.0", license: "GPL-3.0" },
    { name: "express", version: "4.0.0", license: "MIT" },
  ];
  it("copyleft runtime dep → flagged; permissive → değil", () => {
    const res = auditLaneDeps(pkg, sbom);
    const gpl = res.find(r => r.dep === "gpl-lib")!;
    const exp = res.find(r => r.dep === "express")!;
    expect(gpl.category).toBe("copyleft");
    expect(gpl.flagged).toBe(true);
    expect(exp.category).toBe("permissive");
    expect(exp.flagged).toBe(false);
  });
  it("yalnız runtime dependencies denetlenir (devDependencies hariç)", () => {
    const res = auditLaneDeps(pkg, sbom);
    expect(res.map(r => r.dep).sort()).toEqual(["express", "gpl-lib"]);
  });
  it("SBOM yoksa lisans bilinmiyor → flagged=false (pozitif kanıt yok)", () => {
    const res = auditLaneDeps(pkg);
    expect(res.length).toBe(2);
    expect(res.every(r => r.flagged === false)).toBe(true);
    expect(res.every(r => r.category === "unknown")).toBe(true);
  });
  it("dependencies yoksa boş; bozuk JSON → boş", () => {
    expect(auditLaneDeps("{}").length).toBe(0);
    expect(auditLaneDeps("nope").length).toBe(0);
  });
});
