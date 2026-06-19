/**
 * rank.ts — vO4 panel "synthesis" fazı: SAF dedup + discourse + aggregation (PANEL_SCHEMA.md §3).
 *
 * open-code-review (Apache-2.0) discourse/multi-agent-redundancy deseninin saf uyarlaması (kod değil):
 * aynı bulguyu ≥2 persona bağımsız bildirirse consensus boost; ≥2 challenge + 0 support → unresolved.
 * LLM YOK; tüm karar deterministik. Test edilebilir.
 */
import { type DiagnosticNote, noteKey, refDeficit } from "./note";
import type { Severity } from "./detectors";

const ORDER: Severity[] = ["info", "low", "med", "high", "blocker"];

export function severityWeight(s: Severity): number {
  const i = ORDER.indexOf(s);
  return i < 0 ? 0 : i + 1;
}

/** Bir seviye yükselt; blocker tavan. */
export function boostSeverity(s: Severity): Severity {
  const i = ORDER.indexOf(s);
  return i < 0 || i >= ORDER.length - 1 ? s : ORDER[i + 1];
}

export interface DedupeResult { notes: DiagnosticNote[]; duplicatesMerged: number; consensusBoosted: string[]; }

/** noteKey ile grupla; farklı persona ≥2 → tek not (en yüksek severity) + consensus boost. */
export function dedupe(notes: DiagnosticNote[]): DedupeResult {
  const groups = new Map<string, DiagnosticNote[]>();
  for (const n of notes) {
    const k = noteKey(n);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(n);
  }
  const out: DiagnosticNote[] = [];
  const consensusBoosted: string[] = [];
  let duplicatesMerged = 0;
  for (const group of groups.values()) {
    duplicatesMerged += group.length - 1;
    // Temsilci: en yüksek severity (ilk eşit kazanır → kararlı sıra).
    const rep = { ...group.reduce((a, b) => (severityWeight(b.severity) > severityWeight(a.severity) ? b : a)) };
    const personas = [...new Set(group.map((g) => g.persona))].sort();
    rep.consensus = personas;
    if (personas.length >= 2) {
      rep.severity = boostSeverity(rep.severity);
      consensusBoosted.push(rep.id);
    }
    // debate union (çapraz-persona challenge/support korunur).
    rep.debate = {
      challenges: [...new Set(group.flatMap((g) => g.debate.challenges))],
      support: [...new Set(group.flatMap((g) => g.debate.support))],
      verdict: group.map((g) => g.debate.verdict).find(Boolean) || "",
    };
    out.push(rep);
  }
  return { notes: out, duplicatesMerged, consensusBoosted };
}

export interface DiscourseResult { notes: DiagnosticNote[]; unresolvedDebates: string[]; }

/** ≥2 challenge + 0 support → unresolved (rank'te aşağı çekilir, raporda flag). */
export function resolveDiscourse(notes: DiagnosticNote[]): DiscourseResult {
  const unresolvedDebates: string[] = [];
  for (const n of notes) {
    if (n.debate.challenges.length >= 2 && n.debate.support.length === 0) unresolvedDebates.push(n.id);
  }
  return { notes, unresolvedDebates };
}

export interface PanelReport {
  ts: string;
  personaCoverage: Record<string, number>;
  byLane: Record<string, number>;
  ranked: string[];
  duplicatesMerged: number;
  consensusBoosted: string[];
  unresolvedDebates: string[];
  refDeficit: string[];
  stale: string[];
  totals: { bySeverity: Record<string, number>; open: number; adopted: number };
}

/** Sentez raporu (saf). staleIds + dedup/consensus/discourse panel.ts'te hesaplanıp geçilir. */
export function buildReport(
  notes: DiagnosticNote[],
  opts: { ts: string; staleIds?: string[]; duplicatesMerged?: number; consensusBoosted?: string[]; unresolvedDebates?: string[] },
): PanelReport {
  const personaCoverage: Record<string, number> = {};
  const byLane: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let open = 0, adopted = 0;
  for (const n of notes) {
    personaCoverage[n.persona] = (personaCoverage[n.persona] || 0) + 1;
    byLane[n.targetLane] = (byLane[n.targetLane] || 0) + 1;
    bySeverity[n.severity] = (bySeverity[n.severity] || 0) + 1;
    if (n.status === "open") open++;
    if (n.status === "adopted") adopted++;
  }
  const unresolved = new Set(opts.unresolvedDebates ?? []);
  // Sıralama: unresolved en sona; sonra severity↓; eşitlikte id (kararlı).
  const ranked = [...notes].sort((a, b) => {
    const ua = unresolved.has(a.id) ? 1 : 0, ub = unresolved.has(b.id) ? 1 : 0;
    if (ua !== ub) return ua - ub;
    const d = severityWeight(b.severity) - severityWeight(a.severity);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  }).map((n) => n.id);

  return {
    ts: opts.ts,
    personaCoverage, byLane, ranked,
    duplicatesMerged: opts.duplicatesMerged ?? 0,
    consensusBoosted: opts.consensusBoosted ?? [],
    unresolvedDebates: opts.unresolvedDebates ?? [],
    refDeficit: notes.filter(refDeficit).map((n) => n.id),
    stale: opts.staleIds ?? [],
    totals: { bySeverity, open, adopted },
  };
}
