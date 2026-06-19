/**
 * sbom.ts — vO4 GERÇEK-bağımlılık lisans denetimi (ADOPTIONS matris-gate'in ÖTESİ).
 *
 * adopt.ts/gate() yalnız ADOPTIONS_ORCHESTRATION.md matrisini (niyet) denetler. Bu modül
 * lane'lerin GERÇEKTEN kurulu runtime bağımlılıklarını denetler: copyleft bir paket runtime
 * dep olarak sızarsa (lisans kontaminasyonu) yakala.
 *
 * Veri kaynağı: anchore/syft (Apache-2.0) `syft <dir> -o json` SBOM. syft opsiyonel harici
 * binary — yoksa SBOM atlanır (lisans bilinmez → flagged=false, pozitif kanıt yok). KOD
 * KOPYALANMADI: yalnız syft'in JSON çıktısı tüketilir + lisans sınıflaması licenses.ts'ten REUSE.
 */
import { classifyLicense, type LicenseCategory } from "./licenses";

export interface SbomEntry { name: string; version: string; license: string; }

/** syft `-o json` çıktısı → düz {name,version,license}. Bozuk/boş → [] (gate kırılmaz). */
export function parseSyftSbom(json: string): SbomEntry[] {
  let doc: { artifacts?: Array<{ name?: string; version?: string; licenses?: Array<{ value?: string; spdxExpression?: string }> }> };
  try { doc = JSON.parse(json); } catch { return []; }
  const arts = Array.isArray(doc?.artifacts) ? doc.artifacts : [];
  return arts.map(a => {
    const lic = Array.isArray(a.licenses) && a.licenses.length
      ? (a.licenses[0].spdxExpression || a.licenses[0].value || "")
      : "";
    return { name: a.name || "", version: a.version || "", license: lic };
  }).filter(e => e.name);
}

export interface DepAudit { dep: string; version: string; license: string; category: LicenseCategory; flagged: boolean; }

/**
 * Lane package.json runtime dep'lerini SBOM lisanslarıyla sınıfla. SADECE `dependencies`
 * (devDependencies runtime kontaminasyon değil). flagged = strong-copyleft (kullanım riski).
 * SBOM yoksa lisans "unknown" → flagged=false (pozitif kanıt olmadan suçlama yok).
 */
export function auditLaneDeps(pkgJsonText: string, sbom?: SbomEntry[]): DepAudit[] {
  let pkg: { dependencies?: Record<string, string> };
  try { pkg = JSON.parse(pkgJsonText); } catch { return []; }
  const deps = pkg?.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {};
  const byName = new Map((sbom ?? []).map(e => [e.name, e]));
  return Object.entries(deps).map(([dep, declared]) => {
    const hit = byName.get(dep);
    const license = hit?.license ?? "";
    const category = sbom && hit ? classifyLicense(license).category : "unknown";
    return { dep, version: hit?.version ?? String(declared), license, category, flagged: category === "copyleft" };
  });
}
