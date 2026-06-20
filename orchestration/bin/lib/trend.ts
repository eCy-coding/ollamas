/**
 * trend.ts — vO4.2 Panel Trend & History: SAF run-to-run delta (PANEL_SCHEMA + plan vO4.2).
 *
 * Panel tek-snapshot'tı; bu modül append-only history + önceki snapshot'la delta hesaplar:
 * new/resolved/regressed/improved/persistent. SARIF baselineState (new/unchanged/updated/absent)
 * deseni (idea, kod değil). KARARLI eşleştirme `noteKey` ile (id KARARSIZ — her scan yeniden numaralanır).
 * Zero-dep, pure, test edilebilir.
 */
import { type DiagnosticNote, noteKey } from "./note";
import type { Severity } from "./detectors";
import { severityWeight } from "./rank";

/** Kompakt snapshot satırı (history jsonl). Tüm not değil — yalnız key+severity+id (delta için yeter). */
export interface SnapKey { key: string; severity: Severity; id: string; }
export interface Snapshot { ts: string; head: string; keys: SnapKey[]; }

export interface SevChange { key: string; id: string; from: Severity; to: Severity; }
export interface TrendDelta {
  isBaseline: boolean;          // prev boş (ilk çalışma)
  new: SnapKey[];
  resolved: SnapKey[];
  regressed: SevChange[];       // severity↑
  improved: SevChange[];        // severity↓
  persistent: SnapKey[];        // aynı key, aynı severity
}

/** Not listesinden kompakt snapshot. */
export function snapshotOf(notes: DiagnosticNote[], ts: string, head: string): Snapshot {
  return {
    ts, head,
    keys: notes.map((n) => ({ key: noteKey(n), severity: n.severity, id: n.id })),
  };
}

/** İki snapshot arası delta (noteKey eşleştirme). prev.keys boş → isBaseline, hepsi new. */
export function diffSnapshots(prev: Snapshot, curr: Snapshot): TrendDelta {
  const prevMap = new Map(prev.keys.map((k) => [k.key, k]));
  const currMap = new Map(curr.keys.map((k) => [k.key, k]));
  const d: TrendDelta = { isBaseline: prev.keys.length === 0, new: [], resolved: [], regressed: [], improved: [], persistent: [] };

  for (const c of curr.keys) {
    const p = prevMap.get(c.key);
    if (!p) { d.new.push(c); continue; }
    const dw = severityWeight(c.severity) - severityWeight(p.severity);
    if (dw > 0) d.regressed.push({ key: c.key, id: c.id, from: p.severity, to: c.severity });
    else if (dw < 0) d.improved.push({ key: c.key, id: c.id, from: p.severity, to: c.severity });
    else d.persistent.push(c);
  }
  for (const p of prev.keys) if (!currMap.has(p.key)) d.resolved.push(p);
  return d;
}

/** Trend bölümü markdown (PANEL_REPORT.md'ye eklenir). */
export function renderTrend(d: TrendDelta): string {
  if (d.isBaseline) {
    return [
      `## 📈 Trend (run-to-run delta)`,
      ``,
      `_İlk çalışma (baseline) — ${d.new.length} bulgu kaydedildi. Sonraki run'da delta gösterilecek._`,
    ].join("\n");
  }
  const keyList = (ks: SnapKey[]) => (ks.length ? ks.map((k) => `\`${k.id}\``).join(", ") : "—");
  const chgList = (cs: SevChange[]) => (cs.length ? cs.map((c) => `\`${c.id}\` (${c.from}→${c.to})`).join(", ") : "—");
  return [
    `## 📈 Trend (run-to-run delta)`,
    ``,
    `- 🆕 **new** (${d.new.length}): ${keyList(d.new)}`,
    `- ✅ **resolved** (${d.resolved.length}): ${keyList(d.resolved)}`,
    `- 🔺 **regressed** (${d.regressed.length}, severity↑): ${chgList(d.regressed)}`,
    `- 🔻 **improved** (${d.improved.length}, severity↓): ${chgList(d.improved)}`,
    `- ➖ **persistent** (${d.persistent.length}): değişmeyen bulgu`,
  ].join("\n");
}

/** jsonl metnini snapshot[]'a parse et (bozuk satır atlanır — graceful). */
export function parseHistory(jsonl: string): Snapshot[] {
  const out: Snapshot[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && Array.isArray(o.keys)) out.push({ ts: o.ts || "", head: o.head || "", keys: o.keys });
    } catch { /* bozuk satır atla */ }
  }
  return out;
}

/** History'nin son geçerli snapshot'ı (yoksa boş baseline). */
export function lastSnapshot(history: Snapshot[]): Snapshot {
  return history.length ? history[history.length - 1] : { ts: "", head: "", keys: [] };
}
