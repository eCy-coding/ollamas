// eCym federation — mirror the eCym command catalog (~/ecy-model/terminal-dataset.json)
// into the Obsidian vault under `ecym/` so the orchestra's second system appears in the
// same graph as the ollamas brain. READ-ONLY: eCym owns the dataset (grown via ecy-learn),
// so these notes are never pulled back — they mirror the source of truth one way.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

export const _ecymInternals = { toEcymNote, ecymBase };
