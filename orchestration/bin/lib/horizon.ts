/**
 * orchestration/bin/lib/horizon.ts — vO12 Roadmap Horizon Auto-Generator (zero-dep, pure çekirdek).
 *
 * SORUN: ROADMAP vO1→vO11 tükendi → lane STALL eder; "sürdürebilir / 10-versiyon-ileri" mandate'i
 * için hiçbir şey sonraki horizon'u üretmiyor. Bu modül birikmiş sinyalleri (critic Gap'leri + panel
 * open notları + driftguard HARD + lane backlog) → dedup + consensus-boost → sıralı **vO12→vO21**
 * horizon'a çevirir (0 manuel seçim). critic(detect)/conduct(1-eylem)/plan-next(bilinen-versiyon) ile
 * çakışmaz — bunlar tespit eder, bu SIRALAR + versiyonlar. Untracked worker dosyalarını IMPORT ETMEZ
 * (JSON runtime okunur, CLI'da); yalnız committed plan-next/shared'e bağlı.
 */

export type HorizonSource = "critic" | "panel" | "drift" | "backlog";
export interface HorizonSignal { source: HorizonSource; lane: string; title: string; severity: number; key: string; }
export interface HorizonCluster { key: string; lane: string; title: string; severity: number; sources: HorizonSource[]; count: number; }
export interface HorizonItem { ver: string; title: string; rationale: string; severity: number; sources: HorizonSource[]; lanes: string[]; key: string; }

const SEV: Record<string, number> = { blocker: 100, high: 80, hard: 80, med: 50, low: 20, soft: 20, info: 10 };

/** Severity'yi 0-100 sayıya indir (string→harita, sayı→aynen, bilinmeyen→30). */
export function sevToNum(s: string | number): number {
  if (typeof s === "number") return s;
  return SEV[s.toLowerCase()] ?? 30;
}

const short = (s: string) => (s || "").replace(/\s+/g, " ").trim().slice(0, 50);

/** critic CRITIC.json.findings → sinyal. */
export function normalizeCritic(findings: { lane?: string; kind?: string; detail?: string; severity?: string | number }[]): HorizonSignal[] {
  return (findings || []).map((f) => ({
    source: "critic" as const, lane: f.lane || "global",
    title: short(f.detail || f.kind || "gap"), severity: sevToNum(f.severity ?? 30),
    key: `critic:${f.lane || "global"}:${short(f.kind || f.detail || "")}`,
  }));
}

/** panel panel-report.json.notes (yalnız status=open) → sinyal. */
export function normalizePanel(notes: { targetLane?: string; targetPath?: string; finding?: string; severity?: string; status?: string }[]): HorizonSignal[] {
  return (notes || []).filter((n) => n.status === "open").map((n) => ({
    source: "panel" as const, lane: n.targetLane || "global",
    title: short(n.finding || ""), severity: sevToNum(n.severity || "med"),
    key: `panel:${n.targetLane || "global"}:${n.targetPath || short(n.finding || "")}`,
  }));
}

/** driftguard rows (yalnız hard) → sinyal. */
export function normalizeDrift(rows: { lane?: string; check?: string; actual?: string; severity?: string }[]): HorizonSignal[] {
  return (rows || []).filter((r) => r.severity === "hard").map((r) => ({
    source: "drift" as const, lane: r.lane || "global",
    title: short(`${r.check}: ${r.actual}`), severity: 80,
    key: `drift:${r.lane || "global"}:${r.check}`,
  }));
}

/** lane backlog (plan-next currentAndNext'in next'i) → sinyal. */
export function normalizeBacklog(laneNexts: { lane: string; next: string }[]): HorizonSignal[] {
  return (laneNexts || []).filter((l) => l.next).map((l) => ({
    source: "backlog" as const, lane: l.lane, title: short(l.next), severity: 40, key: `backlog:${l.lane}`,
  }));
}

/** Aynı key'leri birleştir: severity = max + (count-1)*8 consensus-boost; source'lar union. */
export function clusterSignals(signals: HorizonSignal[]): HorizonCluster[] {
  const m = new Map<string, HorizonCluster>();
  for (const s of signals) {
    const c = m.get(s.key);
    if (!c) m.set(s.key, { key: s.key, lane: s.lane, title: s.title, severity: s.severity, sources: [s.source], count: 1 });
    else {
      c.severity = Math.max(c.severity, s.severity);
      if (!c.sources.includes(s.source)) c.sources.push(s.source);
      c.count++;
      if (s.title.length > c.title.length) c.title = s.title; // daha açıklayıcı başlık
    }
  }
  // consensus boost: birden çok kez görülen açık daha öncelikli.
  for (const c of m.values()) c.severity += (c.count - 1) * 8;
  return [...m.values()];
}

/** startNum'dan ardışık vO id'leri. */
export function nextVersionIds(startNum: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `vO${startNum + i}`);
}

/** Sinyaller → sıralı (severity↓, key↑ deterministik) → vO id'li horizon (top-count). */
export function synthesizeHorizon(signals: HorizonSignal[], startNum: number, count = 10): HorizonItem[] {
  const clustered = clusterSignals(signals).sort((a, b) => b.severity - a.severity || a.key.localeCompare(b.key));
  const top = clustered.slice(0, count);
  const ids = nextVersionIds(startNum, top.length);
  return top.map((c, i) => ({
    ver: ids[i], title: c.title,
    rationale: `${c.sources.join("+")} sinyali (${c.count}×, sev ${c.severity}) — lane ${c.lane}`,
    severity: c.severity, sources: c.sources, lanes: [c.lane], key: c.key,
  }));
}

/** Horizon markdown (ROADMAP_HORIZON.md). */
export function buildHorizonReport(items: HorizonItem[], ts: string): string {
  if (!items.length) {
    return [`# ROADMAP_HORIZON — ollamas Orchestration (vO12+)`, ``, `> ts: ${ts}`, ``, `✅ Sinyal yok — birikmiş açık/drift/gap bulunamadı; horizon temiz (lane backlog'a düşülebilir).`].join("\n");
  }
  const rows = items.map((it) =>
    `| **${it.ver}** | ${it.title} | ${it.severity} | ${it.sources.join("+")} | ${it.lanes.join(",")} |`);
  return [
    `# ROADMAP_HORIZON — ollamas Orchestration (vO12+)`,
    ``,
    `> Otomatik üretildi (DETERMİNİSTİK, 0-manuel): \`horizon.ts\` — critic+panel+drift+backlog sinyalleri → sıralı versiyon. ts: ${ts}`,
    `> Roadmap tükendiğinde lane'in durmaması için sonraki ${items.length} versiyonu önerir. İnsan/conductor onayıyla ROADMAP'e işlenir.`,
    ``,
    `| Versiyon | Kapsam (sinyalden) | Severity | Kaynak | Lane |`,
    `|----------|--------------------|----------|--------|------|`,
    ...rows,
    ``,
    `_Sinyal kaynakları: critic (completeness gap) · panel (open finding) · drift (HARD) · backlog (lane next). Consensus-boost: çok-kaynak/çok-kez = yüksek öncelik._`,
  ].join("\n");
}
