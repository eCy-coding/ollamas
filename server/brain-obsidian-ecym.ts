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
  // prune stale eCym notes (command removed from catalog) — guarded: never on empty catalog
  if (live.size > 0) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".md") && !live.has(f)) rmSync(join(dir, f));
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

export const _ecymInternals = { toEcymNote, ecymBase };
