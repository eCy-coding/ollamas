/**
 * orchestration/bin/lib/critic.ts — Self-auditing completeness critic (zero-dep, pure).
 *
 * Orchestration sisteminin İÇ tutarlılığını deterministik denetler: roadmap-vs-gerçek drift,
 * orphan artefakt, test-coverage gap, duplicate araç. ML YOK. Açıkları Gap[] olarak üretir →
 * conduct'a beslenebilir (self-improving). Pattern ref: knip/ts-prune (unused), madge (orphan),
 * reflexion (self-reflection), OpenSSF Scorecard (checklist traceability).
 */
import { parseVersions, type VersionEntry } from "../plan-next";

export type GapKind = "roadmap-drift" | "done-no-evidence" | "orphan-artifact" | "coverage-gap" | "duplication";
export interface Gap { kind: GapKind; severity: "high" | "med" | "low"; target: string; detail: string; action: string; }

/** Başlıktan anlamlı kelimeler (eşleştirme için). 3+ harf, küçük harf, noktalama yok. */
export function keywords(title: string): string[] {
  return (title || "").toLowerCase()
    .replace(/[^a-zçğıöşü0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}
const STOP = new Set(["tüm", "için", "tek", "lane", "otomasyon", "sistem", "matris", "canlı", "bütünlük"]);

/** Bir versiyon başlığı bir araç/artefakt adıyla eşleşiyor mu (keyword in name). */
function hasEvidence(v: VersionEntry, names: string[]): boolean {
  const ks = keywords(v.title);
  if (!ks.length) return false;
  const blob = names.join(" ").toLowerCase();
  return ks.some((k) => blob.includes(k.slice(0, Math.max(4, k.length - 2)))); // kök eşleşmesi
}

/**
 * Roadmap-vs-gerçek: DONE ama kanıt-yok + yapıldı-görünüyor-ama-planned drift.
 * names = tool + artefakt adları (kanıt havuzu).
 */
export function auditRoadmapSync(roadmapMd: string, names: string[]): Gap[] {
  const out: Gap[] = [];
  for (const v of parseVersions(roadmapMd)) {
    const evid = hasEvidence(v, names);
    if (v.status === "done" && !evid) {
      out.push({ kind: "done-no-evidence", severity: "med", target: v.ver, detail: `${v.ver} (${v.title}) DONE ama eşleşen araç/artefakt yok`, action: `${v.ver} kanıtını doğrula ya da DONE'ı geri al` });
    }
    if (v.status === "planned" && evid) {
      out.push({ kind: "roadmap-drift", severity: "high", target: v.ver, detail: `${v.ver} (${v.title}) 'planned' ama eşleşen araç/artefakt VAR — muhtemelen yapıldı (roadmap bayat)`, action: `${v.ver} durumunu DONE'a güncelle (roadmap-gerçek reconcile)` });
    }
  }
  return out;
}

/** Orphan: artefakt adı hiçbir .ts kaynağında geçmiyor → tüketilmiyor (madge-style). */
export function auditOrphans(artifactNames: string[], allSourceText: string): Gap[] {
  const src = allSourceText.toLowerCase();
  const out: Gap[] = [];
  for (const a of artifactNames) {
    // Üretilen rapor MD'leri (CONDUCTOR/CRITIC vb) çıktıdır; tüketim beklenen JSON + *_PROMPT.
    if (!/\.(json)$|_prompt\.md$/i.test(a)) continue;
    if (!src.includes(a.toLowerCase())) {
      out.push({ kind: "orphan-artifact", severity: "med", target: a, detail: `${a} hiçbir araçça okunmuyor (orphan/rename drift olabilir)`, action: `${a}'yı tüketen aracı bağla ya da artefakt'ı kaldır` });
    }
  }
  return out;
}

/** Coverage: export edilen fn adı hiçbir test metninde geçmiyor → test'siz. */
export function auditCoverage(exportsByFile: { file: string; fns: string[] }[], testText: string): Gap[] {
  const out: Gap[] = [];
  for (const e of exportsByFile) {
    const untested = e.fns.filter((fn) => !new RegExp(`\\b${fn}\\b`).test(testText));
    if (untested.length) {
      out.push({ kind: "coverage-gap", severity: "low", target: e.file, detail: `${e.file}: test'siz export → ${untested.join(", ")}`, action: `${e.file} için test ekle (${untested.slice(0, 3).join(", ")})` });
    }
  }
  return out;
}

/** Duplication: iki aracın amaç-keyword örtüşmesi yüksekse olası-dup. */
export function auditDuplication(tools: { name: string; purpose: string }[]): Gap[] {
  const out: Gap[] = [];
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const a = new Set(keywords(tools[i].purpose));
      const b = keywords(tools[j].purpose);
      if (!a.size || !b.length) continue;
      const overlap = b.filter((k) => a.has(k)).length;
      const ratio = overlap / Math.min(a.size, b.length);
      if (overlap >= 2 && ratio >= 0.5) {
        out.push({ kind: "duplication", severity: "med", target: `${tools[i].name}↔${tools[j].name}`, detail: `${tools[i].name} ve ${tools[j].name} amaç-örtüşmesi yüksek (${overlap} ortak kelime) — olası duplicate`, action: `${tools[i].name}/${tools[j].name} dedup ya da rol ayrımını netleştir` });
      }
    }
  }
  return out;
}

/** Kapsamlılık skoru 0-100 (severity-ağırlıklı ceza). Deterministik. */
export function scoreCompleteness(gaps: Gap[]): number {
  const W = { high: 12, med: 6, low: 2 };
  const penalty = gaps.reduce((s, g) => s + W[g.severity], 0);
  return Math.max(0, 100 - penalty);
}

/** Tüm denetçileri birleştir. */
export function auditAll(input: {
  roadmapMd: string; toolNames: string[]; artifactNames: string[];
  allSourceText: string; exportsByFile: { file: string; fns: string[] }[];
  testText: string; tools: { name: string; purpose: string }[];
}): Gap[] {
  return [
    ...auditRoadmapSync(input.roadmapMd, [...input.toolNames, ...input.artifactNames]),
    ...auditOrphans(input.artifactNames, input.allSourceText),
    ...auditCoverage(input.exportsByFile, input.testText),
    ...auditDuplication(input.tools),
  ];
}
