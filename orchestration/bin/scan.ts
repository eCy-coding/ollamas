#!/usr/bin/env tsx
/**
 * scan.ts — vO4 panel "parallel review" fazı: persona-başı DETERMİNİSTİK tarayıcı.
 *
 * READ-ONLY: ANCHOR (ana ollamas repo) içinde git-grep + dosya okur, detectors.ts saf detector'larına
 * sayı/içerik besler, `Finding[]` → `DiagnosticNote[]` (confidence:"detected") stamp'ler,
 * `plans/notes/<persona>.detected.json` yazar. Lane tree'ye 0 yazım (§3 scope law).
 *
 * Çalıştır: tsx orchestration/bin/scan.ts <persona>    (persona: project-architect|backend|...)
 *           tsx orchestration/bin/scan.ts --all
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ANCHOR } from "./shared";
import {
  nameVersionMismatch, emptyFile, orphanDir, unreferencedArtifact, wiredNoConsumer,
  lineCount, stripComments,
  chokepointBypass, oversizedComponent, anyDensity,
  hardcodedSecret, insecureHttp,
  shellStrictMode, lanExposure, unquotedRmVar,
  toolMissingOutputSchema, chokepointBypassExec,
  type Finding,
} from "./lib/detectors";
import { PERSONAS, getPersona, PERSONA_NAMES, type Persona, type ScanTarget } from "./lib/personas";
import type { DiagnosticNote } from "./lib/note";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const NOTES_DIR = join(ORCH_DIR, "plans", "notes");

/** ANCHOR'da read-only git-grep; eşleşen satır sayısı. Hata/eşleşmeme → 0 (asla throw). */
function grepCount(token: string, pathspecs: string[]): number {
  try {
    const out = execFileSync("git", ["-C", ANCHOR, "grep", "-I", "-c", "--", token, ...pathspecs], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    // -c → "path:count" satırları; count'ları topla.
    return out.split("\n").filter(Boolean).reduce((s, l) => s + (parseInt(l.split(":").pop() || "0", 10) || 0), 0);
  } catch { return 0; }
}

/**
 * import/from satırlarında dizin-token referans sayısı (orphan tespiti). Kendi dizinini saymaz.
 * Token, modül-yolu TIRNAĞI İÇİNDE olmalı (`from "...token"`) — düz prose "from ... daemon"u
 * referans sayma (ERR-ORCH-006 false-negative dersi: gevşek regex prose-çakışması).
 */
function importRefs(refToken: string, selfPath: string): number {
  try {
    const out = execFileSync("git", ["-C", ANCHOR, "grep", "-I", "-n", "-E",
      `(import|require|from)[^\\n]*['\"][^'\"\\n]*${refToken}`, "--", "src", "server", "bin", "scripts", "*.ts"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter((l) => l && !l.startsWith(selfPath)).length;
  } catch { return 0; }
}

function readIf(rel: string): string | null {
  const full = join(ANCHOR, rel);
  try { return existsSync(full) ? readFileSync(full, "utf8") : null; } catch { return null; }
}

const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", "coverage", "test-results", ".next"]);

/**
 * Sınırlı (maxDepth/maxFiles) READ-ONLY dosya enumerator: dirRel altında globs uzantılı
 * dosyaların {rel, content}'ini döner. graph.ts'i IMPORT ETMEZ (vO5-depgraph worker coupling yok),
 * deseni bağımsız klonlar. node_modules/.git/dist atlanır.
 */
function collectMatchingFiles(dirRel: string, globs: string[] = [], maxFiles = 600, maxDepth = 7): Array<{ rel: string; content: string }> {
  const exts = globs.map((g) => g.replace(/^\*/, "")); // "*.sh" → ".sh"
  const out: Array<{ rel: string; content: string }> = [];
  const root = join(ANCHOR, dirRel);
  const walk = (abs: string, depth: number): void => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries: string[] = [];
    try { entries = readdirSync(abs); } catch { return; }
    for (const name of entries) {
      if (out.length >= maxFiles) return;
      if (SKIP_DIR.has(name) || name.startsWith(".")) continue;
      const full = join(abs, name);
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) walk(full, depth + 1);
      else if (s.isFile() && (exts.length === 0 || exts.some((e) => name.endsWith(e)))) {
        const rel = full.slice(ANCHOR.length + 1);
        try { out.push({ rel, content: readFileSync(full, "utf8") }); } catch { /* atla */ }
      }
    }
  };
  if (existsSync(root)) {
    try { statSync(root).isDirectory() ? walk(root, 0) : out.push({ rel: dirRel, content: readFileSync(root, "utf8") }); } catch { /* yok */ }
  }
  return out;
}

/** İçerik-tarayan kind: path dosya ise tek-dosya, dizin ise globs ile enumerate; detector'ı her dosyada koş. */
function scanContent(t: ScanTarget, fn: (rel: string, content: string) => Finding[]): Finding[] {
  return collectMatchingFiles(t.path, t.globs).flatMap((f) => fn(f.rel, f.content));
}

/** Bir scan target'ı canlı yürüt → Finding[]. */
function runTarget(t: ScanTarget): Finding[] {
  switch (t.kind) {
    case "pkg-meta": {
      const c = readIf(t.path);
      return c ? nameVersionMismatch(c, t.path) : [];
    }
    case "empty-file": {
      const c = readIf(t.path);
      return c === null ? [] : emptyFile(t.path, c);
    }
    case "orphan-dir": {
      const full = join(ANCHOR, t.path);
      if (!existsSync(full)) return [];
      try { if (!statSync(full).isDirectory()) return []; } catch { return []; }
      return orphanDir(t.path, importRefs(t.refToken || basename(t.path), t.path));
    }
    case "unref-artifact":
      return unreferencedArtifact(t.path, grepCount(t.refToken || basename(t.path), ["src", "server", "bin", "scripts", "*.ts"]));
    case "wired-no-consumer": {
      const producer = grepCount(t.producerToken || t.dep || "", ["src", "server", "bin", "*.ts", "package.json"]);
      const consumer = grepCount(t.consumerToken || "", ["src", "server", "deploy", "*.yml", "*.yaml", "*.json"]);
      return wiredNoConsumer(t.dep || "?", producer, consumer, t.path);
    }
    // ── vO4.1 içerik-tarayan kind'ler ──
    case "fe-chokepoint":
      return scanContent(t, (rel, c) => chokepointBypass(rel, c, t.chokepointToken || "apiClient"));
    case "fe-oversized":
      return scanContent(t, (rel, c) => oversizedComponent(rel, lineCount(c), t.threshold ?? 400));
    case "fs-any-density":
      return scanContent(t, (rel, c) => {
        const code = stripComments(c);
        const anyCount = (code.match(/:\s*any\b/g) || []).length;
        return anyDensity(rel, anyCount, lineCount(code));
      });
    case "secret-scan":
      return scanContent(t, (rel, c) => hardcodedSecret(rel, c));
    case "insecure-http":
      return scanContent(t, (rel, c) => insecureHttp(rel, c));
    case "sh-strict":
      return scanContent(t, (rel, c) => shellStrictMode(rel, c));
    case "lan-bind":
      return scanContent(t, (rel, c) => lanExposure(rel, c));
    case "rm-unquoted":
      return scanContent(t, (rel, c) => unquotedRmVar(rel, c));
    case "mcp-exec-bypass":
      return scanContent(t, (rel, c) => chokepointBypassExec(rel, c));
    case "mcp-output-schema": {
      const c = readIf(t.path);
      if (c === null) return [];
      const code = stripComments(c);
      const inp = (code.match(/inputSchema/g) || []).length;
      const outp = (code.match(/outputSchema/g) || []).length;
      // Agregat: inputSchema'lı tool def sayısı > outputSchema → eksik conformance.
      return toolMissingOutputSchema(`${t.path} (${outp}/${inp} outputSchema)`, inp > 0, outp >= inp);
    }
    default: return [];
  }
}

/** Finding → DiagnosticNote (detected). targetHash = HEAD (drift/stale için, vO8 köprü). */
export function toDetectedNote(f: Finding, persona: Persona, idx: number, head: string, ts: string): DiagnosticNote {
  return {
    id: `${persona.name}-${persona.targetLane}-${idx}`,
    persona: persona.name,
    targetLane: persona.targetLane,
    targetPath: f.targetPath,
    severity: f.severity,
    confidence: "detected",
    finding: f.finding,
    evidence: f.evidence,
    solution: undefined,            // çözüm insan tarafından <persona>.md'de yazılır
    minRefs: 2,
    status: "open",
    debate: { challenges: [], support: [], verdict: "" },
    source: "detected",
    targetHash: head,
    ts,
  };
}

function headShort(): string {
  try {
    return execFileSync("git", ["-C", ANCHOR, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return "?"; }
}

function scanPersona(p: Persona, head: string, ts: string): DiagnosticNote[] {
  const notes: DiagnosticNote[] = [];
  let idx = 1;
  for (const t of p.targets) for (const f of runTarget(t)) notes.push(toDetectedNote(f, p, idx++, head, ts));
  return notes;
}

function writeDetected(persona: string, notes: DiagnosticNote[]): string {
  if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true });
  const out = join(NOTES_DIR, `${persona}.detected.json`);
  writeFileSync(out, JSON.stringify({ persona, count: notes.length, notes }, null, 2) + "\n");
  return out;
}

/** Tüm (veya verilen) persona'ları tara + detected.json yaz. panel.ts --refresh bunu çağırır. */
export function runAllScans(personas: Persona[] = PERSONAS): number {
  const head = headShort();
  const ts = new Date().toISOString();
  let total = 0;
  for (const p of personas) {
    const notes = scanPersona(p, head, ts);
    writeDetected(p.name, notes);
    total += notes.length;
  }
  return total;
}

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error(`Kullanım: scan.ts <persona>|--all\nPersona'lar: ${PERSONA_NAMES.join(", ")}`);
    process.exit(2);
  }
  const head = headShort();
  const ts = new Date().toISOString();
  const targets = arg === "--all" ? PERSONAS : [getPersona(arg)].filter(Boolean) as Persona[];
  if (!targets.length) { console.error(`Persona çözülemedi: "${arg}". Bilinen: ${PERSONA_NAMES.join(", ")}`); process.exit(1); }
  for (const p of targets) {
    const notes = scanPersona(p, head, ts);
    const out = writeDetected(p.name, notes);
    console.log(`[scan] ${p.name}: ${notes.length} detected bulgu → ${out}`);
  }
}

if (process.argv[1] && /scan\.ts$/.test(process.argv[1])) main();
