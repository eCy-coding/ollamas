#!/usr/bin/env tsx
/**
 * panel.ts — vO4 panel "Tech-Lead orchestrator" (open-code-review Apache-2.0 deseni; kod değil).
 *
 * Akış: plans/notes/*.detected.json (makine) + <persona>.md authored (insan) → merge → dedupe →
 * discourse → stale → buildReport → render PANEL_REPORT.md + panel-report.json yaz.
 * Pure çekirdek (mergeNotes/computeStale/renderReport) test edilebilir; main canlı sarmalayıcı.
 * READ-ONLY ANCHOR; yalnız orchestration/plans/ altına yazar (§3 scope law).
 *
 * Çalıştır: tsx orchestration/bin/panel.ts
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ANCHOR } from "./shared";
import { parseNotes, type DiagnosticNote } from "./lib/note";
import { dedupe, resolveDiscourse, buildReport, type PanelReport } from "./lib/rank";
import { PERSONA_NAMES } from "./lib/personas";
import { runAllScans } from "./scan";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const PLANS_DIR = join(ORCH_DIR, "plans");
const NOTES_DIR = join(PLANS_DIR, "notes");

// ── Pure çekirdek ──────────────────────────────────────────────────────────────

/** detected + authored birleştir: aynı id'de authored kazanır (insan çözümü). Eşleşmeyen authored eklenir. */
export function mergeNotes(detected: DiagnosticNote[], authored: DiagnosticNote[]): DiagnosticNote[] {
  const byId = new Map<string, DiagnosticNote>();
  for (const n of detected) byId.set(n.id, n);
  for (const a of authored) {
    const d = byId.get(a.id);
    // authored kazanır; detected evidence/targetHash yoksa koru.
    byId.set(a.id, d ? { ...d, ...a, evidence: a.evidence.length ? a.evidence : d.evidence, targetHash: a.targetHash ?? d.targetHash } : a);
  }
  return [...byId.values()];
}

/** targetHash mevcut HEAD'le uyuşmayan notlar (drift/stale; düzeltilmiş bulguyu OPEN raporlama). */
export function computeStale(notes: DiagnosticNote[], head: string): string[] {
  return notes.filter((n) => n.targetHash && n.targetHash !== head).map((n) => n.id);
}

function sevTag(s: string): string {
  return ({ blocker: "🟥 blocker", high: "🟧 high", med: "🟨 med", low: "🟦 low", info: "⬜ info" } as Record<string, string>)[s] || s;
}

/** PANEL_REPORT.md deterministik composer (golden-test edilebilir). */
export function renderReport(rep: PanelReport, notes: DiagnosticNote[]): string {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const cov = PERSONA_NAMES.map((p) => `${p}:${rep.personaCoverage[p] || 0}`).join("  ");
  const sevLine = ["blocker", "high", "med", "low", "info"].map((s) => `${s}:${rep.totals.bySeverity[s] || 0}`).join("  ");
  const idList = (ids: string[]) => (ids.length ? ids.map((i) => `\`${i}\``).join(", ") : "—");

  const rows = rep.ranked.map((id) => {
    const n = byId.get(id);
    if (!n) return `| \`${id}\` | ? | ? | ? | (eksik) | ? |`;
    const flags = [
      rep.consensusBoosted.includes(id) ? "🤝" : "",
      rep.unresolvedDebates.includes(id) ? "⚔️" : "",
      rep.refDeficit.includes(id) ? "📭" : "",
      rep.stale.includes(id) ? "🕒" : "",
    ].filter(Boolean).join("");
    const fnd = n.finding.replace(/\|/g, "\\|").slice(0, 80);
    return `| \`${id}\` | ${n.persona} | ${n.targetLane} | ${sevTag(n.severity)} | ${fnd} | ${n.status}${flags ? " " + flags : ""} |`;
  });

  return [
    `# PANEL_REPORT — ollamas Expert Diagnostic Panel (vO4)`,
    ``,
    `> Üretici: \`panel.ts\` (DETERMİNİSTİK; LLM yok). ts: ${rep.ts}`,
    `> Bayrak: 🤝 consensus-boost · ⚔️ unresolved-debate · 📭 refDeficit · 🕒 stale`,
    ``,
    `## Özet`,
    `- Severity: ${sevLine}`,
    `- Açık (open): ${rep.totals.open} · Adopted: ${rep.totals.adopted}`,
    `- Dedup birleştirme: ${rep.duplicatesMerged} · Consensus boost: ${rep.consensusBoosted.length}`,
    `- Persona kapsamı: ${cov}`,
    ``,
    `## Sıralı bulgular (severity↓, unresolved en sona)`,
    `| id | persona | lane | severity | finding | status |`,
    `|----|---------|------|----------|---------|--------|`,
    ...rows,
    ``,
    `## Bayraklı listeler`,
    `- **refDeficit** (kaynak yetersiz, refs<minRefs): ${idList(rep.refDeficit)}`,
    `- **unresolvedDebates** (≥2 challenge, 0 support): ${idList(rep.unresolvedDebates)}`,
    `- **consensusBoosted** (≥2 persona aynı bulgu): ${idList(rep.consensusBoosted)}`,
    `- **stale** (targetHash≠HEAD, drift): ${idList(rep.stale)}`,
    ``,
    `## ⚪ UNCOVERED uzmanlar (0 detected, 0 authored)`,
    rep.uncovered.length
      ? rep.uncovered.map((p) => `- ⚪ \`${p}\` — bu uzman henüz hiç bulgu üretmedi (detector ekle veya not yaz)`).join("\n")
      : `- ✅ tüm 8 uzman kapsandı`,
    ``,
    `---`,
    `_Bu sekme (orchestration) lane kodunu yazmaz (§3). Bulgular = öneri; çözüm lane sekmesinde uygulanır._`,
  ].join("\n");
}

// ── Canlı sarmalayıcı ────────────────────────────────────────────────────────

function headShort(): string {
  try {
    return execFileSync("git", ["-C", ANCHOR, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return "?"; }
}

function loadDetected(): DiagnosticNote[] {
  if (!existsSync(NOTES_DIR)) return [];
  const out: DiagnosticNote[] = [];
  for (const f of readdirSync(NOTES_DIR)) {
    if (!f.endsWith(".detected.json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(NOTES_DIR, f), "utf8"));
      if (Array.isArray(j.notes)) out.push(...j.notes);
    } catch { /* bozuk → atla */ }
  }
  return out;
}

function loadAuthored(): { notes: DiagnosticNote[]; errors: string[] } {
  const notes: DiagnosticNote[] = [];
  const errors: string[] = [];
  if (!existsSync(NOTES_DIR)) return { notes, errors };
  for (const f of readdirSync(NOTES_DIR)) {
    if (!f.endsWith(".md") || f === "TEMPLATE.note.md" || f === "DISCOURSE.md") continue;
    const r = parseNotes(readFileSync(join(NOTES_DIR, f), "utf8"));
    notes.push(...r.notes);
    for (const e of r.errors) errors.push(`${f}: ${e}`);
  }
  return { notes, errors };
}

function main(): void {
  const head = headShort();
  const ts = new Date().toISOString();
  // Sürdürebilir tek-komut: --refresh → önce tüm persona'ları tara, sonra raporla.
  if (process.argv.includes("--refresh")) {
    const n = runAllScans();
    console.log(`[panel] --refresh: ${n} detected bulgu tarandı`);
  }
  const detected = loadDetected();
  const { notes: authored, errors } = loadAuthored();
  for (const e of errors) console.error(`[panel] authored parse uyarısı: ${e}`);

  const merged = mergeNotes(detected, authored);
  const { notes: deduped, duplicatesMerged, consensusBoosted } = dedupe(merged);
  const { unresolvedDebates } = resolveDiscourse(deduped);
  const staleIds = computeStale(deduped, head);

  const rep = buildReport(deduped, { ts, staleIds, duplicatesMerged, consensusBoosted, unresolvedDebates });

  if (!existsSync(PLANS_DIR)) mkdirSync(PLANS_DIR, { recursive: true });
  const mdOut = join(PLANS_DIR, "PANEL_REPORT.md");
  const jsonOut = join(PLANS_DIR, "panel-report.json");
  writeFileSync(mdOut, renderReport(rep, deduped) + "\n");
  writeFileSync(jsonOut, JSON.stringify({ report: rep, notes: deduped }, null, 2) + "\n");
  console.log(`[panel] ${deduped.length} not (detected ${detected.length} + authored ${authored.length}); HEAD ${head}`);
  console.log(`[panel] yazıldı → ${mdOut} + ${jsonOut}`);
}

if (process.argv[1] && /panel\.ts$/.test(process.argv[1])) main();
