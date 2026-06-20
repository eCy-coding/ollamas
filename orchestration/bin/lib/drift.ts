/**
 * drift.ts — vO5 cross-package VERSION-DRIFT tespiti (depgraph API-gap'in ÖTESİ).
 *
 * depgraph.ts frontend↔backend API-kontrat boşluğunu çözer. Bu modül ikinci boyutu ekler:
 * aynı npm bağımlılığı farklı lane'lerde farklı versiyona pinlenmiş mi? (syncpack MIT
 * single-version-policy deseni — kod kopyalanmadı, desen port edildi). Çift-bundle / uyumsuz
 * peer riski. Zero-dep: yalnız package.json'ları okur + range string'lerini karşılaştırır.
 *
 * GOTCHA (RISK-ORCH-011): range eşitliği STRING-bazlı, semver-aware DEĞİL — '^18.0.0' vs
 * '^18.2.0' farklı sayılır (kasıtlı: pin tutarlılığı politikası tam-eşitlik ister).
 */

export interface LaneDeps { lane: string; deps: Record<string, string>; }
export interface Pin { lane: string; range: string; }
export interface DriftRow { name: string; pins: Pin[]; drifted: boolean; }

/** package.json metni → {name: range} (dependencies + devDependencies birleşik). Bozuk → {}. */
export function laneDepMap(pkgJsonText: string): Record<string, string> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try { pkg = JSON.parse(pkgJsonText); } catch { return {}; }
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
}

/**
 * Bağımlılığı isimle grupla; bir lane'de gözüken her pin'i topla. distinct range > 1 → drifted.
 * Çıktı: drifted satırlar önce, sonra isimce alfabetik (rapor önceliği).
 */
export function detectVersionDrift(lanes: LaneDeps[]): DriftRow[] {
  const byDep = new Map<string, Pin[]>();
  for (const { lane, deps } of lanes) {
    for (const [name, range] of Object.entries(deps)) {
      if (!byDep.has(name)) byDep.set(name, []);
      byDep.get(name)!.push({ lane, range });
    }
  }
  const rows: DriftRow[] = [];
  for (const [name, pins] of byDep) {
    const distinct = new Set(pins.map(p => p.range));
    rows.push({ name, pins, drifted: distinct.size > 1 });
  }
  // drifted önce, sonra isimce
  rows.sort((a, b) => (a.drifted === b.drifted ? a.name.localeCompare(b.name) : a.drifted ? -1 : 1));
  return rows;
}

/** Yalnız drifted satırları markdown tablo; drift yoksa temiz mesaj. */
export function toDriftTable(rows: DriftRow[]): string {
  const drifted = rows.filter(r => r.drifted);
  if (!drifted.length) return "_✅ version-drift yok — tüm paylaşılan bağımlılıklar lane'ler arası tek versiyonda._";
  const head = ["| Bağımlılık | Pin'ler (lane: range) | Lane# |", "|---|---|---|"];
  const body = drifted.map(r =>
    `| \`${r.name}\` | ${r.pins.map(p => `${p.lane}: \`${p.range}\``).join(" · ")} | ${r.pins.length} |`);
  return [...head, ...body].join("\n");
}
