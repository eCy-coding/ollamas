/**
 * orchestration/bin/lib/licenses.ts — Lisans sınıflandırma (zero-dep, pure).
 *
 * Embedded SPDX map = DATA (spdx/license-list-data, public domain) — KOD değil. Lisans
 * disiplini (ORCHESTRATION_AGENTS ADOPTIONS, RISK-ORCH-005): permissive→kopya OK;
 * copyleft/weak-copyleft→yalnız ref/idea/eval; unknown→yalnız idea.
 */

export type LicenseCategory = "permissive" | "weak-copyleft" | "copyleft" | "unknown";
export interface LicenseClass { category: LicenseCategory; allowCopy: boolean; }

/** ~40 yaygın SPDX id → kategori. allowCopy yalnız permissive için true. */
const SPDX: Record<string, LicenseCategory> = {
  // permissive
  "MIT": "permissive", "ISC": "permissive", "0BSD": "permissive",
  "BSD-2-CLAUSE": "permissive", "BSD-3-CLAUSE": "permissive", "BSD-3-CLAUSE-CLEAR": "permissive",
  "APACHE-2.0": "permissive", "BSL-1.0": "permissive", "ZLIB": "permissive",
  "UNLICENSE": "permissive", "WTFPL": "permissive", "CC0-1.0": "permissive",
  "PYTHON-2.0": "permissive", "X11": "permissive", "POSTGRESQL": "permissive",
  "BLUEOAK-1.0.0": "permissive", "MIT-0": "permissive", "ARTISTIC-2.0": "permissive",
  // weak-copyleft (dosya/lib-düzeyi; statik-link kopya sakıncalı)
  "LGPL-2.1": "weak-copyleft", "LGPL-3.0": "weak-copyleft",
  "MPL-2.0": "weak-copyleft", "MPL-1.1": "weak-copyleft",
  "CDDL-1.0": "weak-copyleft", "EPL-2.0": "weak-copyleft", "EPL-1.0": "weak-copyleft",
  "EUPL-1.2": "weak-copyleft", "OSL-3.0": "weak-copyleft",
  // copyleft (güçlü; kod kopyalama YASAK)
  "GPL-2.0": "copyleft", "GPL-3.0": "copyleft",
  "AGPL-3.0": "copyleft", "GFDL-1.3": "copyleft", "SSPL-1.0": "copyleft",
  // OSS-olmayan serbest işaretler (native komut/öz-kod/public-domain/açık-spec) → permissive eşdeğeri.
  "SYSTEM": "permissive", "OWN": "permissive", "NATIVE": "permissive",
  "PUBLIC DOMAIN": "permissive", "PUBLIC": "permissive", "ACADEMIC": "permissive",
  "SPEC": "permissive", "OPEN SPEC": "permissive", "AÇIK SPEC": "permissive", "AÇIK": "permissive",
};

/** SPDX id'yi normalize et: büyük harf, "+"/"-only"/"-or-later"/"-LICENSE" ekleri at. */
export function normalizeId(id: string): string {
  return (id || "").trim().toUpperCase()
    .replace(/\s+LICEN[SC]E$/i, "")
    .replace(/-ONLY$|-OR-LATER$|\+$/i, "")
    .replace(/^\(|\)$/g, "")
    .trim();
}

/** Serbest metin copyleft mi? (SPDX id yoksa fallback). */
export function isCopyleft(text: string): boolean {
  return /(A?GPL|LGPL|GFDL|SSPL|EUPL|MPL|CDDL|EPL|OSL|Commons[\s.-]?Clause|copyleft|Affero)/i.test(text || "");
}

/** Lisans id/metin → kategori + kopya izni. */
export function classifyLicense(idOrText: string): LicenseClass {
  const norm = normalizeId(idOrText);
  const cat = SPDX[norm];
  if (cat) return { category: cat, allowCopy: cat === "permissive" };
  // SPDX map'te yok: copyleft regex fallback, yoksa unknown.
  if (isCopyleft(idOrText)) return { category: "copyleft", allowCopy: false };
  return { category: "unknown", allowCopy: false };
}

export type Decision =
  | "ADOPT" | "pattern-ADOPT" | "eval-only" | "ref-only" | "idea-only"
  | "future-ref" | "mental-model" | "SKIP" | "unknown";

const COPY_DECISIONS = new Set<Decision>(["ADOPT", "pattern-ADOPT"]); // kod kopyalama ima eder
const SAFE_NONCOPY = new Set<Decision>(["ref-only", "idea-only", "future-ref", "eval-only", "mental-model", "SKIP"]);

/**
 * Karar lisans-disiplinine uygun mu?
 * - permissive: her karar OK.
 * - copyleft/weak: yalnız no-copy karar (ref/idea/eval/future/mental). ADOPT → İHLAL.
 * - unknown: yalnız idea-only/future-ref/SKIP. Aksi → İHLAL.
 */
export function decisionAllowed(category: LicenseCategory, decision: Decision): { ok: boolean; reason: string } {
  if (category === "permissive") return { ok: true, reason: "permissive: her karar serbest" };
  if (category === "copyleft" || category === "weak-copyleft") {
    if (COPY_DECISIONS.has(decision)) {
      return { ok: false, reason: `${category}: '${decision}' kod kopyalama ima eder — yalnız ref-only/idea-only/eval-only/future-ref izinli (RISK-ORCH-005)` };
    }
    return { ok: true, reason: `${category}: '${decision}' no-copy → OK` };
  }
  // unknown
  if (decision === "idea-only" || decision === "future-ref" || decision === "SKIP") {
    return { ok: true, reason: "unknown lisans: idea-only/future-ref/SKIP OK" };
  }
  return { ok: false, reason: `unknown lisans + '${decision}' — lisans doğrulanana dek yalnız idea-only` };
}
