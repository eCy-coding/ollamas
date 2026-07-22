// eCym federation — mirror the eCym command catalog (~/ecy-model/terminal-dataset.json)
// into the Obsidian vault under `ecym/` so the orchestra's second system appears in the
// same graph as the ollamas brain. READ-ONLY: eCym owns the dataset (grown via ecy-learn),
// so these notes are never pulled back — they mirror the source of truth one way.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { noteFilename } from "./brain-obsidian-note";

export interface EcymCommand {
  id: string;
  level: string;        // baslangic | orta | ileri
  triggers: string[];
  cmd: string;
  arg?: string;
  desc: string;
  safe: boolean;
}

export function ecymDatasetPath(): string {
  return process.env.ECY_DATASET || `${process.env.HOME}/ecy-model/terminal-dataset.json`;
}

/** Read the eCym command catalog. Returns [] if the dataset is absent (eCym not installed). */
export function readEcymCommands(path = ecymDatasetPath()): EcymCommand[] {
  try {
    const d = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(d?.commands) ? (d.commands as EcymCommand[]) : [];
  } catch { return []; }
}

const ecymBase = (id: string) => `ecym-${noteFilename(id).replace(/\.md$/, "")}`;

// The dataset stores `safe` inconsistently (some rows bool, some Python-repr strings
// "True"/"False") — normalize, else a string "False" reads truthy and a gated command
// would be mislabelled safe.
function isSafe(v: unknown): boolean {
  return v === true || String(v).toLowerCase() === "true";
}

function toEcymNote(c: EcymCommand): string {
  const title = c.desc?.length > 60 ? c.desc.slice(0, 57).trimEnd() + "…" : (c.desc || c.id);
  const aliases = [...new Set([title, ...(c.triggers || [])])].slice(0, 6);
  const safe = isSafe(c.safe);
  const tags = ["system/ecym", `ecym/${c.level}`, safe ? "ecym/safe" : "ecym/gated"];
  const fm = [
    `id: ${JSON.stringify(`ecym:${c.id}`)}`,
    `system: ecym`,
    `level: ${JSON.stringify(c.level)}`,
    `safe: ${safe}`,
    `aliases: [${aliases.map((a) => JSON.stringify(a)).join(", ")}]`,
    `cssclasses: [brain, system-ecym]`,
    `tags: [${tags.join(", ")}]`,
  ].join("\n");
  const cmdLine = `${c.cmd}${c.arg ? " " + c.arg : ""}`;
  const flavour = safe ? "todo" : "warning";
  return `---\n${fm}\n---\n\n# ${title}\n\n`
    + `> [!${flavour}] eCym · ${c.level} · ${safe ? "safe" : "gated"}\n\n`
    + `${c.desc}\n\n`
    + "```bash\n" + cmdLine + "\n```\n\n"
    + `**Triggers:** ${(c.triggers || []).map((t) => `\`${t}\``).join(" · ") || "—"}\n`;
}

/** Materialize the eCym catalog under `ecym/`. Prunes notes whose command id vanished from
 *  the dataset (source of truth). Returns the count written. */
export function writeEcymNotes(vault: string, path = ecymDatasetPath()): number {
  const cmds = readEcymCommands(path);
  const dir = join(vault, "ecym");
  mkdirSync(dir, { recursive: true });
  const live = new Set<string>();
  for (const c of cmds) {
    if (!c?.id) continue;
    const name = `${ecymBase(c.id)}.md`;
    live.add(name);
    writeFileSync(join(dir, name), toEcymNote(c));
  }
  // Prune stale COMMAND notes only — a command dropped from the catalog should not linger.
  // Guarded twice: never on an empty catalog, and never outside the `ecym-` namespace this
  // function owns. The second guard is not theoretical: everything else in this folder (the
  // eCym hub, the learning queue, anything the operator writes) was being deleted on every
  // sync and only survived because it happened to be rewritten later in the same push.
  // Relying on write order to undo a delete is not a design.
  if (live.size > 0) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith("ecym-") && f.endsWith(".md") && !live.has(f)) rmSync(join(dir, f));
    }
  }
  return live.size;
}

// L10: eCym learning queue — the misses.log holds questions eCym could not answer locally
// (`<question>\t<tier>`), which ecy-learn drafts into new commands (manual-approve). Mirror
// the tail so the growth pipeline is visible in the vault. Read-only.
export function writeEcymLearningQueue(vault: string, missesPath = `${process.env.HOME}/ecy-model/misses.log`): number {
  const dir = join(vault, "ecym");
  mkdirSync(dir, { recursive: true });
  let rows: { q: string; tier: string }[] = [];
  try {
    rows = readFileSync(missesPath, "utf8").trim().split("\n").filter(Boolean).slice(-40).reverse()
      .map((l) => { const [q, tier] = l.split("\t"); return { q: (q || "").replace(/^<|>$/g, ""), tier: tier || "" }; })
      .filter((r) => r.q);
  } catch { /* no misses yet */ }
  const list = rows.map((r) => `- [ ] ${r.q.slice(0, 100).replace(/\|/g, "/")} \`${r.tier}\``).join("\n");
  writeFileSync(join(dir, "_learning-queue.md"),
    `---\ncssclasses: [brain, system-ecym]\ntags: [system/ecym, ecym/learning]\naliases: [eCym learning queue]\n---\n\n`
    + `# 🌱 eCym öğrenme kuyruğu\n\n> [!tip] eCym'in yerel çözemediği ${rows.length} soru. \`ecy-learn\` bunları yeni komut taslağına çevirir → onay → \`terminal-dataset.json\`.\n\n`
    + `${list || "_(henüz kaçırılan yok)_"}\n\n[[Orchestra]] · kaynak: \`~/ecy-model/misses.log\` (read-only)\n`);
  return rows.length;
}

// L16: vault → eCym learning handoff. When a human checks `- [x] <question>` in
// ecym/_learning-queue.md, append it to ~/ecy-model/approved-learning.jsonl — the queue
// ecy-learn consumes to draft new commands. We ONLY write the approval signal; we never
// touch terminal-dataset.json (that's ecy-learn's job, with its own draft+approve step).
// Deduped by question so re-syncs don't pile up. Returns how many NEW approvals were added.
export function readApprovedLearning(vault: string, outPath = `${process.env.HOME}/ecy-model/approved-learning.jsonl`): number {
  const qPath = join(vault, "ecym", "_learning-queue.md");
  let content = "";
  try { content = readFileSync(qPath, "utf8"); } catch { return 0; }
  const approved = [...content.matchAll(/^\s*-\s*\[x\]\s*(.+?)(?:\s+`[^`]*`)?\s*$/gim)].map((m) => m[1].trim()).filter(Boolean);
  if (!approved.length) return 0;
  const seen = new Set<string>();
  try { for (const l of readFileSync(outPath, "utf8").trim().split("\n")) { try { seen.add(JSON.parse(l).q); } catch { /* skip */ } } } catch { /* new file */ }
  let added = 0;
  const at = Date.now();
  for (const q of approved) {
    if (seen.has(q)) continue;
    seen.add(q);
    appendFileSync(outPath, JSON.stringify({ q, at, approved: true, via: "obsidian" }) + "\n");
    added++;
  }
  return added;
}

// L23: close the eCym learning loop. L16 records vault approvals into approved-learning.jsonl,
// but ecy-learn only reads misses.log — so an approval never became a command draft. This
// bridge feeds each approved question into misses.log (`<q>\tvault-approved`) so the next
// `ecy-learn` run drafts a command for it. HONEST BOUNDARY: we only queue the miss; we never
// touch terminal-dataset.json — ecy-learn's manual draft+approve step still owns that. Deduped
// against misses.log's existing questions (ecy-learn itself also dedups unique requests), so a
// re-run is a no-op. Returns the questions newly queued.
export function bridgeApprovedToMisses(opts: { approvedPath?: string; missesPath?: string } = {}): { added: number; queued: string[] } {
  const approvedPath = opts.approvedPath || `${process.env.HOME}/ecy-model/approved-learning.jsonl`;
  const missesPath = opts.missesPath || `${process.env.HOME}/ecy-model/misses.log`;
  // approved questions (q, approved:true)
  let approved: string[] = [];
  try {
    approved = readFileSync(approvedPath, "utf8").trim().split("\n").filter(Boolean)
      .map((l) => { try { const j = JSON.parse(l); return j && j.approved !== false ? String(j.q || "").trim() : ""; } catch { return ""; } })
      .filter(Boolean);
  } catch { return { added: 0, queued: [] }; }
  if (!approved.length) return { added: 0, queued: [] };
  // existing misses (strip the `<...>` wrapper ecy uses) — dedup target
  const seen = new Set<string>();
  try {
    for (const l of readFileSync(missesPath, "utf8").trim().split("\n")) {
      const q = (l.split("\t")[0] || "").replace(/^<|>$/g, "").trim();
      if (q) seen.add(q);
    }
  } catch { /* no misses.log yet — first queue creates it */ }
  const queued: string[] = [];
  for (const q of approved) {
    if (seen.has(q)) continue;
    seen.add(q);
    appendFileSync(missesPath, `<${q}>\tvault-approved\n`);
    queued.push(q);
  }
  return { added: queued.length, queued };
}

/** Gated vs safe counts, using the same normalisation the notes are written with —
 *  a naive truthy check reads the dataset's "False" strings as safe. */
export function ecymSplit(commands: EcymCommand[]): { gated: number; safe: number } {
  let safe = 0;
  for (const c of commands) if (isSafe(c.safe)) safe++;
  return { gated: commands.length - safe, safe };
}

/**
 * ecym.base — an Obsidian Bases database over the eCym command catalog.
 *
 * The catalog was 221 notes with no view at all. Every note already carried `level`, `safe`
 * and `id`, so the data for a proper database was there the whole time; nothing was reading
 * it. brain.base cannot cover this — it is scoped to tier-tagged memories on purpose.
 *
 * Written by code rather than by hand because a base that declares no structure is swept
 * into _index/attic by sweepEmptyShells(); the `filters:` block below is what keeps it.
 */
export function writeEcymBase(vault: string): void {
  const base = `filters:\n  and:\n      - file.hasTag("system/ecym")\n`
    + `formulas:\n  risk: 'if(note.safe, "✅ güvenli", "⚠️ gated")'\n`
    + `properties:\n`
    + `  note.level:\n    displayName: Seviye\n`
    + `  note.safe:\n    displayName: Güvenli\n`
    + `  note.id:\n    displayName: Komut id\n`
    + `views:\n`
    + `  - type: table\n    name: Tümü\n    order:\n      - file.name\n      - note.level\n      - formula.risk\n      - note.id\n    limit: 300\n`
    + `  - type: table\n    name: Seviye bazlı\n    groupBy:\n      property: note.level\n      direction: ASC\n    order:\n      - file.name\n      - formula.risk\n`
    + `  - type: table\n    name: ⚠️ Gated\n    filters:\n      and:\n        - note.safe == false\n    order:\n      - file.name\n      - note.level\n      - note.id\n`
    + `  - type: table\n    name: ✅ Güvenli\n    filters:\n      and:\n        - note.safe == true\n    order:\n      - file.name\n      - note.level\n`
    + `  - type: cards\n    name: Kartlar\n    order:\n      - file.name\n      - note.level\n`;
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "ecym.base"), base);
}

/**
 * eCym.md — the human entry point for the catalog, mirroring how Orchestra.md fronts the
 * orchestra. Counts are passed in from the writer that just produced the notes, so the page
 * can never disagree with what is actually on disk.
 *
 * The learning queue is rendered as a Tasks query rather than a static list: the queue is a
 * set of open checkboxes and obsidian-tasks-plugin is installed, so this turns it into a
 * board that stays correct as items are ticked off in the vault.
 */
export function writeEcymHub(
  vault: string,
  total: number,
  split: { gated: number; safe: number } = { gated: 0, safe: 0 },
): void {
  const dir = join(vault, "ecym");
  mkdirSync(dir, { recursive: true });
  const md = `---\ncssclasses: [brain, system-ecym]\ntags: [system/ecym, moc]\naliases: [eCym, eCym komut merkezi]\n---\n\n`
    + `# 🟢 eCym komut merkezi\n\n`
    + `> [!abstract] Yerel komut kataloğu\n`
    + `> **${total}** komut · ⚠️ **${split.gated}** gated · ✅ **${split.safe}** güvenli\n\n`
    + `> [!warning] Gated komutlar onay ister\n`
    + `> \`safe: false\` olan her komut çalıştırılmadan önce ECY_YES kapısından geçer.\n\n`
    + `## 🗃️ Katalog\n![[ecym.base]]\n\n`
    + `## 🌱 Öğrenme kuyruğu\n`
    + `> [!tip] eCym'in yerel çözemediği sorular. Onaylananlar \`ecy-learn\` taslağına döner.\n\n`
    + "```tasks\nnot done\npath includes ecym\nshort mode\n```\n\n"
    + `[[Home]] · [[_learning-queue]]\n`;
  writeFileSync(join(dir, "eCym.md"), md);
}

export const _ecymInternals = { toEcymNote, ecymBase };
