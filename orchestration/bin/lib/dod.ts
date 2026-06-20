/**
 * orchestration/bin/lib/dod.ts — Definition-of-Done + Concurrent-Task detector (zero-dep, pure).
 *
 * Çalışma alanını deterministik tarar: yarım-iş (code-without-test), eksik (uncommitted-green,
 * done-without-governance), eş-zamanlı-gereken (yeni tool ⇒ test+roadmap+SEYIR), marker (TODO/FIXME).
 * ML YOK. Pattern ref: danger.js (DoD-as-rule), leasot (marker), git co-change coupling, spec-kit traceability.
 */

export type LapseRule = "code-without-test" | "roadmap-coherence" | "uncommitted-green" | "done-without-governance" | "marker" | "concurrent-task";
export interface Lapse { rule: LapseRule; severity: "high" | "med" | "low"; target: string; detail: string; action: string; concurrent?: boolean; }

const baseName = (p: string) => p.replace(/^.*\//, "").replace(/\.test\.ts$/, "").replace(/\.ts$/, "");

/** R1: export'lu modül için test'lerde adı geçiyor mu. exportsByFile: {file, fnCount}. */
export function auditTests(modules: { file: string; fnCount: number }[], testText: string): Lapse[] {
  const out: Lapse[] = [];
  for (const m of modules) {
    if (m.fnCount === 0) continue; // export yok → CLI-only, test gerekmez
    const stem = baseName(m.file);
    if (!new RegExp(`\\b${stem}\\b|/${stem}["']`).test(testText)) {
      out.push({ rule: "code-without-test", severity: "high", target: m.file, detail: `${m.file} (${m.fnCount} export) test'te geçmiyor — yarım iş`, action: `${m.file} için tests/${stem}.test.ts ekle` });
    }
  }
  return out;
}

/** R3: git porcelain satırları (orchestration) → unshipped. */
export function auditUncommitted(porcelainLines: string[]): Lapse[] {
  const files = porcelainLines.map((l) => l.trim().replace(/^\S+\s+/, "")).filter((f) => /orchestration\/.*\.(ts|md|json)$/.test(f) && !/\.(bak|tmp)$/.test(f));
  if (!files.length) return [];
  return [{ rule: "uncommitted-green", severity: "med", target: `${files.length} dosya`, detail: `Commit'siz yeşil iş (built-not-shipped): ${files.slice(0, 6).map(baseName).join(", ")}${files.length > 6 ? "…" : ""}`, action: `yeşil parçayı commit'le (per-file git add + conventional)` }];
}

/** R5: marker grep sonuçları (her satır "file: count"). */
export function auditMarkers(grepCounts: { file: string; count: number }[]): Lapse[] {
  return grepCounts.filter((g) => g.count > 0).map((g) => ({
    rule: "marker", severity: "low", target: g.file, detail: `${g.file}: ${g.count} TODO/FIXME/HACK (yarım-kod izi)`, action: `${g.file} marker'larını çöz ya da issue'la`,
  }));
}

/** R6: concurrent — her tool için {test, roadmap-row, SEYIR} üçlüsü; biri varsa diğeri eksikse eş-zamanlı Lapse. */
export function auditConcurrent(toolStems: string[], testStems: Set<string>, roadmapText: string, seyirText: string): Lapse[] {
  const out: Lapse[] = [];
  for (const stem of toolStems) {
    const hasTest = testStems.has(stem);
    const hasRoadmap = new RegExp(`\\b${stem}\\b`, "i").test(roadmapText);
    const hasSeyir = new RegExp(`\\b${stem}\\b`, "i").test(seyirText);
    const present = [hasTest, hasRoadmap, hasSeyir].filter(Boolean).length;
    if (present > 0 && present < 3) {
      const missing = [!hasTest && "test", !hasRoadmap && "roadmap-row", !hasSeyir && "SEYIR-entry"].filter(Boolean);
      out.push({ rule: "concurrent-task", severity: "med", target: stem, detail: `${stem} kısmen tamam — eksik eş-zamanlı: ${missing.join(", ")}`, action: `${stem} için ${missing.join(" + ")} aynı anda tamamla`, concurrent: true });
    }
  }
  return out;
}

/** R4: roadmap DONE vO'lar SEYIR'de geçiyor mu (governance traceability). */
export function auditGovernance(doneVersions: string[], seyirText: string): Lapse[] {
  return doneVersions.filter((v) => !new RegExp(`\\b${v}\\b`, "i").test(seyirText)).map((v) => ({
    rule: "done-without-governance", severity: "med", target: v, detail: `${v} DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)`, action: `${v} için SEYIR girdisi + errors_registry güncelle`,
  }));
}

/** R2: built-tool roadmap'te map'leniyor mu (her tool stem roadmap'te geçmeli — gevşek). */
export function auditRoadmapCoherence(toolStems: string[], roadmapText: string): Lapse[] {
  // Çekirdek araçlar (lib helper değil) roadmap'te anılmalı.
  return toolStems.filter((s) => !new RegExp(`\\b${s}\\b`, "i").test(roadmapText)).map((s) => ({
    rule: "roadmap-coherence", severity: "low", target: s, detail: `${s} aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)`, action: `${s}'yi ilgili vO satırına ekle`,
  }));
}

/** Tamamlanmışlık skoru 0-100 (severity-ağırlıklı). Deterministik. */
export function scoreDoD(lapses: Lapse[]): number {
  const W = { high: 10, med: 5, low: 1 };
  return Math.max(0, 100 - lapses.reduce((s, l) => s + W[l.severity], 0));
}
