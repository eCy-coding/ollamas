/**
 * backlog.ts (lib) — vO15 cross-lane CRITICAL backlog delivery (PURE, deterministik).
 *
 * Conductor cross-lane bulgularını (drift HARD + quality RED + panel high) sahibi lane'e göre
 * grupla → severity-rank → yapıştır-hazır FIX-PROMPT. Conductor FIXLEMEZ (§3) — backlog üretir,
 * sahibi lane uygular. I/O yok → test edilebilir. backlog.ts CLI raporları okuyup besler.
 */
import { KNOWN_LANES } from "../shared";

export interface CritFinding {
  lane: string;
  source: "drift" | "quality" | "panel";
  severity: number;   // 0-100 (HARD/high=yüksek)
  title: string;
  fix: string;
}

/** string-veya-obje çözümü güvenle metne indir (panel.solution bazen {text,refs} objesi). */
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as any;
    return o.text || o.summary || o.fix || o.desc || (Array.isArray(o) ? o.map(asText).join("; ") : "");
  }
  return v == null ? "" : String(v);
}

const SEV: Record<string, number> = { hard: 90, high: 80, med: 50, medium: 50, soft: 40, low: 20 };
function sevNum(s: unknown): number {
  if (typeof s === "number") return s;
  return SEV[String(s ?? "").toLowerCase()] ?? 40;
}

/** Drift satır metninden sahibi lane'i çıkar (yapısal alan veya bilinen-lane regex). */
function driftLane(text: string, row: any): string {
  if (row && typeof row.lane === "string" && row.lane) return row.lane;
  return KNOWN_LANES.find((l) => new RegExp(`\\b${l}\\b`, "i").test(text)) || "";
}

/**
 * 3 kaynağı (drift/quality/panel) CritFinding'e normalize + lane-grupla + severity-DESC + dedup.
 * Dönüş: { lane: CritFinding[] } (boş kaynak → atla, never-throw).
 */
export function aggregateBacklog(drift: any, quality: any, panel: any[]): Record<string, CritFinding[]> {
  const items: CritFinding[] = [];

  // quality.redLanes → RED (test/tsc fail) = yüksek öncelik.
  for (const r of quality?.redLanes ?? []) {
    if (!r?.lane) continue;
    items.push({ lane: r.lane, source: "quality", severity: 85, title: `Quality RED: ${r.detail ?? "fail"}`,
      fix: "Lane testlerini koş, KÖK-neden düzelt (semptom YASAK); gate (lint+test) geçmeden commit etme." });
  }

  // panel findings → teşhis + çözüm.
  for (const f of panel ?? []) {
    const lane = f?.targetLane || f?.lane;
    if (!lane) continue;
    const path = f?.targetPath ? ` (${f.targetPath})` : "";
    items.push({ lane, source: "panel", severity: sevNum(f?.severity),
      title: `${asText(f?.finding) || "panel bulgusu"}${path}`,
      fix: asText(f?.solution) || "Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt." });
  }

  // driftguard rows ([HARD]/soft choke-point/branch/version).
  const rows = Array.isArray(drift) ? drift : drift?.rows ?? [];
  for (const row of rows) {
    const text = typeof row === "string" ? row : row?.detail || row?.msg || JSON.stringify(row ?? {});
    const lane = driftLane(text, row);
    if (!lane) continue;
    const hard = /HARD/i.test(text) || row?.tier === "HARD" || row?.hard === true;
    items.push({ lane, source: "drift", severity: hard ? 90 : 40,
      title: text.replace(/_\(.*?\)_/g, "").replace(/\s+/g, " ").trim().slice(0, 120),
      fix: "Drift gider: declared⇒actual tutarlılık (choke-point bypass→tek-dispatch / branch≡versiyon)." });
  }

  // lane-grupla + dedup(lane+title) + severity-DESC.
  const map: Record<string, CritFinding[]> = {};
  for (const it of items) (map[it.lane] ??= []).push(it);
  for (const lane of Object.keys(map)) {
    const seen = new Set<string>();
    map[lane] = map[lane]
      .filter((it) => (seen.has(it.title) ? false : (seen.add(it.title), true)))
      .sort((a, b) => b.severity - a.severity);
  }
  return map;
}

const PRINCIPLE =
  "**Çalışma prensibi:** LANE_AGENTS'a uy · **TDD** (test önce) · **root-cause-first** (semptom YASAK) · " +
  "**gate-before-commit** (lint+test+conformance) · per-file `git add` (asla -A) · adopt-not-vibe (top-star macOS repo).";

/** Bir lane'in critical backlog'unu sahibi sekmeye YAPIŞTIR-hazır prompt'a render et. */
export function renderLaneBacklog(lane: string, items: CritFinding[]): string {
  if (!items?.length) return `## Backlog — \`${lane}\`\n\n✓ temiz — critical bulgu yok.\n`;
  const lines = items.map((it, i) =>
    `${i + 1}. **[${it.severity} ${it.source}]** ${it.title}\n   🔧 ${it.fix}`);
  return [
    `## Backlog — \`${lane}\` lane (${items.length} critical)`,
    ``,
    `> Conductor üretti (READ-ONLY). Bu prompt'u \`${lane}\` sekmesine YAPIŞTIR → düzelt. Conductor FIXLEMEZ (§3).`,
    ``,
    ...lines,
    ``,
    PRINCIPLE,
    ``,
  ].join("\n");
}

/** Tüm lane'lerin cross-backlog'u (CROSS_BACKLOG.md). */
export function renderCrossBacklog(map: Record<string, CritFinding[]>): string {
  const lanes = Object.keys(map).sort((a, b) =>
    (map[b].reduce((s, f) => s + f.severity, 0)) - (map[a].reduce((s, f) => s + f.severity, 0)));
  const total = lanes.reduce((s, l) => s + map[l].length, 0);
  return [
    `# CROSS_BACKLOG — Conductor → Lane Critical Teslim`,
    ``,
    `> ${lanes.length} lane · ${total} critical bulgu (drift HARD + quality RED + panel). Severity-toplamına göre sıralı.`,
    `> Her section'ı sahibi lane sekmesine yapıştır. Conductor üretir, lane uygular (§3).`,
    ``,
    ...lanes.map((l) => renderLaneBacklog(l, map[l])),
  ].join("\n");
}
