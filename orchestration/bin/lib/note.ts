/**
 * note.ts — SAF teşhis-notu parse/validate (vO4 panel). PANEL_SCHEMA.md §2 sözleşmesi.
 *
 * İnsan-yazımı `plans/notes/<persona>.md` içindeki ` ```note ` JSON bloklarını çıkarır, doğrular,
 * default doldurur. Zero-dep (native regex + JSON.parse). Çözüm UYDURMAZ — yalnız okur/doğrular.
 */
import type { Severity, Evidence } from "./detectors";

export interface Ref { repo: string; license: string; url: string; kind: "copy" | "ref-only" | "idea"; }
export interface Solution { summary: string; refs: Ref[]; }
export interface Debate { challenges: string[]; support: string[]; verdict: string; }

export interface DiagnosticNote {
  id: string;
  persona: string;
  targetLane: string;
  targetPath: string;
  severity: Severity;
  confidence: "detected" | "asserted";
  finding: string;
  evidence: Evidence[];
  solution?: Solution;
  minRefs: number;
  status: "open" | "triaged" | "adopted" | "rejected";
  debate: Debate;
  source: "detected" | "authored";
  targetHash?: string;
  ts?: string;
  /** dedupe sonrası: aynı bulguyu bağımsız bildiren persona'lar (consensus boost kanıtı). */
  consensus?: string[];
}

const SEVERITIES: Severity[] = ["blocker", "high", "med", "low", "info"];
const NOTE_BLOCK = /```note\s*\n([\s\S]*?)\n```/g;

export interface ParseResult { notes: DiagnosticNote[]; errors: string[]; }

/** Markdown'dan tüm ```note bloklarını çıkar, parse+validate et. Bozuk blok → errors, kalan devam. */
export function parseNotes(md: string): ParseResult {
  const notes: DiagnosticNote[] = [];
  const errors: string[] = [];
  let m: RegExpExecArray | null;
  NOTE_BLOCK.lastIndex = 0;
  let i = 0;
  while ((m = NOTE_BLOCK.exec(md)) !== null) {
    i++;
    let obj: unknown;
    try { obj = JSON.parse(m[1]); } catch { errors.push(`note bloğu #${i}: bozuk JSON`); continue; }
    const v = validateNote(obj);
    if (v.ok && v.note) notes.push(v.note);
    else errors.push(`note bloğu #${i}: ${v.error}`);
  }
  return { notes, errors };
}

export interface ValidateResult { ok: boolean; note?: DiagnosticNote; error?: string; }

/** Zorunlu alanları doğrula + default doldur (minRefs=2, status=open, source=authored). */
export function validateNote(obj: unknown): ValidateResult {
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "obje değil" };
  const o = obj as Record<string, unknown>;
  for (const req of ["id", "persona", "targetLane", "targetPath", "finding"]) {
    if (typeof o[req] !== "string" || !(o[req] as string).trim()) return { ok: false, error: `eksik/boş alan: ${req}` };
  }
  if (!SEVERITIES.includes(o.severity as Severity)) return { ok: false, error: `geçersiz severity: ${String(o.severity)}` };

  const sol = o.solution as Record<string, unknown> | undefined;
  const note: DiagnosticNote = {
    id: o.id as string,
    persona: o.persona as string,
    targetLane: o.targetLane as string,
    targetPath: o.targetPath as string,
    severity: o.severity as Severity,
    confidence: o.confidence === "detected" ? "detected" : "asserted",
    finding: o.finding as string,
    evidence: Array.isArray(o.evidence) ? (o.evidence as Evidence[]) : [],
    solution: sol && typeof sol === "object"
      ? { summary: String(sol.summary ?? ""), refs: Array.isArray(sol.refs) ? (sol.refs as Ref[]) : [] }
      : undefined,
    minRefs: typeof o.minRefs === "number" ? o.minRefs : 2,
    status: ["open", "triaged", "adopted", "rejected"].includes(o.status as string) ? (o.status as DiagnosticNote["status"]) : "open",
    debate: normalizeDebate(o.debate),
    source: o.source === "detected" ? "detected" : "authored",
    targetHash: typeof o.targetHash === "string" ? o.targetHash : undefined,
    ts: typeof o.ts === "string" ? o.ts : undefined,
  };
  return { ok: true, note };
}

function normalizeDebate(d: unknown): Debate {
  const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
  return {
    challenges: Array.isArray(o.challenges) ? (o.challenges as string[]) : [],
    support: Array.isArray(o.support) ? (o.support as string[]) : [],
    verdict: typeof o.verdict === "string" ? o.verdict : "",
  };
}

/** Kaynak yetersiz mi? solution yok VEYA refs < minRefs. */
export function refDeficit(note: DiagnosticNote): boolean {
  if (!note.solution) return true;
  return note.solution.refs.length < note.minRefs;
}

/** Çapraz-persona dedup anahtarı: targetPath + normalize(finding). Persona/id'den bağımsız. */
export function noteKey(note: DiagnosticNote): string {
  const norm = note.finding.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${note.targetPath.toLowerCase()}::${norm}`;
}
