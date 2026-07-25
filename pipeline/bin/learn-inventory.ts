#!/usr/bin/env -S npx tsx
// learn-inventory — scan the four real systems and prove which language constructs they use.
//
// WHY THIS EXISTS
// The operator asked for a coding-learning tier that is "%100 eksiksiz". Over MDN (~10k pages)
// that is an unfalsifiable claim. This program replaces it with a finite, checkable one:
//
//     completeness = (constructs with a lesson) / (constructs detected in our own code)
//
// Every entry in `pipeline/lib/learn/track-*.ts` carries a DETECTOR. This scanner runs those
// detectors over ollamas, eCym, the Obsidian vault and the Claude Code surface, and records the
// real `path:line` occurrences. A construct with zero hits is DROPPED — we refuse to teach what
// this codebase does not use, and we never ship a stub page to pad the count.
//
// The output is consumed twice: `learn-build.ts` renders the lessons from it (each lesson shows
// its real example), and `_bin/learn-verify.sh` recomputes coverage independently, so the gate
// cannot be satisfied by the builder simply asserting success.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { ALL_CONSTRUCTS } from "../lib/learn/index";
import { MAX_EXAMPLES, type Construct, type InventoryEntry, type Occurrence } from "../lib/learn/types";
import { CURRICULUM } from "../lib/learnrefs";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");

/** A scanned system: the operator's four names, mapped to real roots on this machine. */
interface SystemRoot {
  system: "ollamas" | "ecym" | "obsidian" | "claudecode";
  /** Absolute directories OR single files to walk. Missing ones are skipped (machine drift). */
  roots: string[];
  /** Path prefix stripped in the recorded provenance, so paths stay short and stable. */
  base: string;
  /** When set, only files whose basename matches are scanned (used to fence shared bin dirs). */
  include?: RegExp;
}

/**
 * WHY THE CLAUDE-CODE ROOTS ARE A NAMED LIST AND NOT `~/.claude`
 * `~/.claude/skills` holds 206 skills, almost all VENDORED (tob-*, ag-*, analytics-*, …). Walking
 * the whole directory pulled in 9 733 files and made every detector report hits "in claudecode",
 * which is false: those are other people's bundles sitting on this disk, not code this operator
 * writes or maintains. The scan is therefore fenced to the surface that is actually authored
 * here — commands, hooks, agents, the locally-written skills, and the two config files.
 *
 * Likewise `~/.local/bin` is a shared bin directory; the `include` filter keeps eCym's scan to
 * the `ecy*` family it really owns.
 */
const SYSTEMS: SystemRoot[] = [
  {
    system: "ollamas",
    base: REPO,
    roots: [join(REPO, "pipeline"), join(REPO, "server"), join(REPO, "cli"), join(REPO, "web"), join(REPO, "scripts"), join(REPO, "orchestration")],
  },
  {
    system: "ecym",
    base: HOME,
    roots: [join(HOME, "ecy-model"), join(HOME, ".local", "bin")],
    include: /(^ecy|ecym|code-kb|terminal-dataset|brain\.vec|provider-pool)/i,
  },
  {
    system: "obsidian",
    base: VAULT,
    roots: [join(VAULT, "_bin"), join(VAULT, "_index"), join(VAULT, "_help"), join(VAULT, "help"), join(VAULT, "templates"), join(VAULT, "_coordination")],
  },
  // launchd plists live outside every repo but ARE authored here (`com.ollamas.*`, `com.ecy.*`);
  // without them the `sh-launchd` detector would report the automation layer as non-existent.
  {
    system: "obsidian",
    base: join(HOME, "Library", "LaunchAgents"),
    roots: [join(HOME, "Library", "LaunchAgents")],
    include: /^com\.(ollamas|ecy)\./,
  },
  {
    system: "claudecode",
    base: join(HOME, ".claude"),
    roots: [
      join(HOME, ".claude", "commands"),
      join(HOME, ".claude", "hooks"),
      join(HOME, ".claude", "agents"),
      join(HOME, ".claude", "vault-protection"),
      join(HOME, ".claude", "skills", "cc-kb"),
      join(HOME, ".claude", "skills", "ecydev"),
      join(HOME, ".claude", "skills", "ai-pipeline"),
      join(HOME, ".claude", "skills", "sovereign-ops"),
      join(HOME, ".claude", "settings.json"),
      join(HOME, ".claude", "CLAUDE.md"),
    ],
  },
];

/**
 * Directories and files the scanner must never open.
 *
 * Two are load-bearing rather than merely noisy:
 *   * `pipeline/lib/learn/` holds the detectors themselves — their regex source text would match
 *     their own patterns and every construct would report a fake hit in the catalogue.
 *   * `*.bak-*` are the timestamped backups this build creates; counting them would multiply
 *     every hit by the number of backups sitting next to the file.
 */
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|dist-plugin|build|coverage|coverage-pipeline|__pycache__|\.venv|venv|artifacts|audit-out|\.obsidian|_sandbox|attic|pipeline\/lib\/learn)(\/|$)/;
const SKIP_FILE = /(\.bak-|\.bak$|\.min\.|\.map$|\.lock$|package-lock|\.png$|\.jpg$|\.gif$|\.zip$|\.gz$|\.m4a$|\.docx$|\.pdf$|\.svg$|\.db$|\.sqlite)/;
const MAX_BYTES = 512 * 1024;

function walk(dir: string, out: string[], depth = 0): string[] {
  if (depth > 8 || !existsSync(dir) || SKIP_DIR.test(dir)) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".") && name !== ".claude") continue;
    const p = join(dir, name);
    if (SKIP_DIR.test(p) || SKIP_FILE.test(p)) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else if (st.isFile() && st.size > 0 && st.size <= MAX_BYTES) out.push(p);
  }
  return out;
}

/** Read a file as text, or null when it is binary/unreadable. */
function readText(p: string): string | null {
  try {
    const buf = readFileSync(p);
    if (buf.includes(0)) return null; // NUL byte ⇒ binary
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Rank occurrences so the lesson shows a READABLE line, not the longest one.
 * Short, non-comment, non-test lines win; that is what a reader wants to see first.
 */
function rankOccurrence(o: Occurrence): number {
  let score = 200 - Math.min(o.snippet.length, 200);
  if (/^\s*(\/\/|#|\*)/.test(o.snippet)) score -= 120; // a comment is not a usage
  if (/\.(test|spec)\./.test(o.path)) score -= 60;
  if (/\bexport\b/.test(o.snippet)) score += 20;
  return score;
}

interface FileRec {
  system: string;
  /** `<system>:<relative path>` — the provenance string printed in lessons. */
  label: string;
  rel: string;
  text: string;
  lines: string[];
}

function collectFiles(): FileRec[] {
  const files: FileRec[] = [];
  for (const s of SYSTEMS) {
    const paths: string[] = [];
    for (const r of s.roots) {
      if (!existsSync(r)) continue;
      if (statSync(r).isFile()) paths.push(r);
      else walk(r, paths);
    }
    for (const p of paths) {
      if (s.include && !s.include.test(p.split("/").pop() ?? "")) continue;
      const text = readText(p);
      if (text === null) continue;
      const rel = relative(s.base, p);
      files.push({ system: s.system, rel, label: `${s.system}:${rel}`, text, lines: text.split("\n") });
    }
  }
  return files;
}

/** Run one detector over the corpus. Returns evidence, or null when the construct is unused. */
function detect(c: Construct, files: FileRec[]): InventoryEntry | null {
  const occurrences: Occurrence[] = [];
  const systems = new Set<string>();
  let hits = 0;

  // Match against the WHOLE file and convert byte offsets to line numbers, rather than testing
  // line by line. A per-line loop silently drops every multi-line detector (`^---\n\w+:` can
  // never match one line) — `md-frontmatter` reported zero hits across a vault full of
  // frontmatter until this was fixed.
  const global = new RegExp(c.pattern.source, c.pattern.flags.includes("g") ? c.pattern.flags : c.pattern.flags + "g");
  for (const f of files) {
    if (!c.files.test(f.rel)) continue;
    global.lastIndex = 0;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = global.exec(f.text)) !== null) {
      found = true;
      hits++;
      const line = f.text.slice(0, m.index).split("\n").length;
      const snippet = (f.lines[line - 1] ?? m[0]).trim().slice(0, 160);
      if (snippet) occurrences.push({ path: f.label, line, snippet });
      if (m[0].length === 0) global.lastIndex++; // zero-width match guard
      if (hits > 5000) break; // pathological detector guard
    }
    if (found) systems.add(f.system);
  }

  if (!hits || !occurrences.length) return null;
  const examples = occurrences
    .sort((a, b) => rankOccurrence(b) - rankOccurrence(a))
    .filter((o, i, arr) => arr.findIndex((x) => x.path === o.path) === i) // one example per file
    .slice(0, MAX_EXAMPLES);
  return { construct: c, hits, examples, systems: [...systems].sort() };
}

export interface Inventory {
  /** Detectors that fired, with evidence. */
  entries: InventoryEntry[];
  /** Detectors that found nothing — reported, never silently dropped. */
  unused: string[];
  filesScanned: number;
  bySystem: Record<string, number>;
  byTrack: Record<string, number>;
}

export function buildInventory(): Inventory {
  const files = collectFiles();
  const entries: InventoryEntry[] = [];
  const unused: string[] = [];
  for (const c of ALL_CONSTRUCTS) {
    const e = detect(c, files);
    if (e) entries.push(e);
    else unused.push(c.id);
  }
  const bySystem: Record<string, number> = {};
  for (const f of files) bySystem[f.system] = (bySystem[f.system] ?? 0) + 1;
  const byTrack: Record<string, number> = {};
  for (const e of entries) byTrack[e.construct.track] = (byTrack[e.construct.track] ?? 0) + 1;
  return { entries, unused, filesScanned: files.length, bySystem, byTrack };
}

/** The machine index consumed by learn-build and re-checked by learn-verify. */
export function inventoryJson(inv: Inventory, stamp: string): string {
  return JSON.stringify(
    {
      generated: stamp,
      filesScanned: inv.filesScanned,
      bySystem: inv.bySystem,
      byTrack: inv.byTrack,
      taught: inv.entries.length,
      detectors: inv.entries.length + inv.unused.length,
      unused: inv.unused,
      // coverage is 1.0 BY CONSTRUCTION here (every detected construct has an authored lesson,
      // because the detector and the lesson are the same record). learn-verify recomputes it
      // from the rendered notes on disk, which is the check that can actually fail.
      coverage: inv.entries.length === 0 ? 0 : 1,
      constructs: inv.entries.map((e) => ({
        id: e.construct.id,
        track: e.construct.track,
        title: e.construct.title,
        level: e.construct.level,
        source: e.construct.source,
        url: e.construct.url ?? null,
        hits: e.hits,
        systems: e.systems,
        examples: e.examples,
      })),
    },
    null,
    2,
  );
}

/** The human-readable inventory note. */
export function inventoryMd(inv: Inventory, stamp: string): string {
  const L: string[] = [
    "# Kod Envanteri — Learn tier'ın kapsama tabanı",
    "",
    `> Üretim: ${stamp} · taranan dosya: **${inv.filesScanned}** · dedektör: **${inv.entries.length + inv.unused.length}** · kanıtlanmış yapı: **${inv.entries.length}**`,
    "",
    "Bu tier'ın **%100 tanımı** budur: MDN'in tamamı değil, *bu dört sistemin gerçekten kullandığı*",
    "her dil yapısı. Her satır, kodda bulunmuş gerçek bir `dosya:satır` kanıtına dayanır; hiç",
    "bulunmayan yapı ders olmaz (boş sayfa üretmeyiz), ama **listelenir** — gizlenmez.",
    "",
    "## Sistem başına taranan dosya",
    "",
    "| Sistem | Dosya |",
    "|--------|-------|",
  ];
  for (const [s, n] of Object.entries(inv.bySystem).sort()) L.push(`| \`${s}\` | ${n} |`);

  L.push("", "## İzlek başına ders", "", "| İzlek | Başlık | Ders |", "|-------|--------|------|");
  for (const t of CURRICULUM) {
    L.push(`| [[learn-${t.id}\\|${t.id}]] | ${t.title} | ${inv.byTrack[t.id] ?? 0} |`);
  }

  L.push("", "## Kanıtlanmış yapılar", "", "| Ders | İzlek | Seviye | Bulgu | Sistemler | İlk kanıt |", "|------|-------|--------|-------|-----------|-----------|");
  for (const e of [...inv.entries].sort((a, b) => a.construct.track.localeCompare(b.construct.track) || b.hits - a.hits)) {
    const ex = e.examples[0];
    L.push(
      `| [[learn-${e.construct.id}\\|${e.construct.id}]] | \`${e.construct.track}\` | ${e.construct.level} | ${e.hits} | ${e.systems.join(", ")} | \`${ex.path}:${ex.line}\` |`,
    );
  }

  if (inv.unused.length) {
    L.push("", "## Kodda bulunmayan dedektörler (ders üretilmedi)", "");
    L.push("> Dürüstlük kaydı: bu yapılar kataloğa yazıldı ama bu dört sistemde kullanılmıyor.");
    L.push("> Ders üretmek yerine burada listelenirler — kapsama oranı bunlara göre DEĞİL,");
    L.push("> bulunan yapılara göre hesaplanır.");
    L.push("");
    for (const id of inv.unused) L.push(`- \`${id}\``);
  }

  L.push("", "---", "**Hub:** [[learn]] · **Kaynaklar:** [[learn-kaynaklar]]", "");
  return L.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--vault");
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const inv = buildInventory();

  console.log(`taranan dosya: ${inv.filesScanned}`);
  console.log(`dedektör: ${inv.entries.length + inv.unused.length} · kanıtlanmış: ${inv.entries.length} · kullanılmayan: ${inv.unused.length}`);
  for (const [t, n] of Object.entries(inv.byTrack).sort()) console.log(`  ${t.padEnd(14)} ${n}`);
  if (inv.unused.length) console.log(`kullanılmayan dedektörler: ${inv.unused.join(", ")}`);

  if (write) {
    mkdirSync(join(VAULT, "_learn"), { recursive: true });
    mkdirSync(join(VAULT, "_index"), { recursive: true });
    writeFileSync(join(VAULT, "_index", "learn-inventory.json"), inventoryJson(inv, stamp), "utf8");
    writeFileSync(join(VAULT, "_learn", "INVENTORY.md"), inventoryMd(inv, stamp), "utf8");
    console.log(`yazıldı: _index/learn-inventory.json · _learn/INVENTORY.md`);
  }
}

if (process.argv[1] && process.argv[1].includes("learn-inventory")) main();
