// Obsidian ⇄ brain bridge (I/O side). The human-facing, graph-navigable mirror of the
// sqlite-vec brain: every memory becomes a markdown note, every fact-graph entity a
// linked note, so Obsidian's graph view IS the brain's fact graph. Bidirectional and
// idempotent — a manifest (_index/.sync-state.json) makes re-runs cheap and safe.
//
// Directions:
//   push (brain→vault): authoritative mirror. brain is source of truth for content.
//   pull (vault→brain): human-authored/edited notes flow back via brainRemember (an
//                       explicit-id idempotent upsert). New notes ingested; edits upsert.
//   both: pull THEN push — human edits enter the brain FIRST, so the subsequent mirror
//         never overwrites an un-ingested edit (data-loss guard).
// Never auto-deletes: a note removed by hand is re-materialized from the brain on push,
// so an accidental vault edit can't erase a memory. Reuses exportBrain (server/brain-portable)
// for enumeration and brainRemember (server/brain.ts:1156) for the write choke-point.
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { exportBrain, type BrainDump } from "./brain-portable";
import { toMarkdown, parseMarkdown, noteFilename, contentHash, TIERS, type NoteMemory } from "./brain-obsidian-note";

export function defaultVaultPath(): string {
  return process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`;
}
export function defaultDbPath(): string {
  return process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
}

interface ManifestEntry { brainHash: string; vaultHash: string }
type Manifest = Record<string, ManifestEntry>;

interface SyncOpts {
  vault?: string;
  dbPath?: string;
  /** injected for tests — defaults to the real in-process brainRemember. */
  remember?: (m: { id: string; tier: any; content: string; source?: string; ns?: string; createdAt?: number; hits?: number }) => Promise<unknown>;
}
export type Direction = "both" | "push" | "pull";

export interface SyncResult {
  direction: Direction;
  push: { written: number; skipped: number; entities: number };
  pull: { ingested: number; skipped: number; conflicts: number };
  vault: string;
  memories: number;
}

const manifestPath = (vault: string) => join(vault, "_index", ".sync-state.json");

function loadManifest(vault: string): Manifest {
  try { return JSON.parse(readFileSync(manifestPath(vault), "utf8")); } catch { return {}; }
}
function saveManifest(vault: string, m: Manifest): void {
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(manifestPath(vault), JSON.stringify(m, null, 0));
}

function ensureDirs(vault: string): void {
  for (const t of TIERS) mkdirSync(join(vault, t), { recursive: true });
  mkdirSync(join(vault, "entities"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  mkdirSync(join(vault, "_index", "conflicts"), { recursive: true });
}

// ── Entity graph (fact side) → linked notes so Obsidian's graph = the brain fact graph ──
function writeEntityNotes(vault: string, facts: BrainDump["facts"]): number {
  const live = facts.filter((f) => f.invalidatedAt === null);
  const bySubject = new Map<string, { label: string; edges: { predicate: string; object: string }[] }>();
  for (const f of live) {
    const key = f.subject.toLowerCase().trim();
    if (!key) continue;
    const e = bySubject.get(key) || { label: f.subject, edges: [] };
    e.edges.push({ predicate: f.predicate, object: f.object });
    bySubject.set(key, e);
  }
  let written = 0;
  for (const [, e] of bySubject) {
    const links = e.edges
      .map((ed) => `- ${ed.predicate} → [[entity-${noteFilename(ed.object.toLowerCase().trim()).replace(/\.md$/, "")}]]`)
      .join("\n");
    const md = `---\ntype: entity\nname: ${JSON.stringify(e.label)}\ntags: [entity]\n---\n\n# ${e.label}\n\n${links}\n`;
    writeFileSync(join(vault, "entities", `entity-${noteFilename(e.label.toLowerCase().trim())}`), md);
    written++;
  }
  return written;
}

function writeMoc(vault: string, dump: BrainDump, entities: number): void {
  const counts = TIERS.map((t) => `- **${t}**: ${dump.memories.filter((m) => m.tier === t).length}`).join("\n");
  const md = `---\ntype: moc\ntags: [moc]\n---\n\n# ollamas brain — Map of Content\n\n`
    + `Memories: ${dump.memories.length} · Facts: ${dump.facts.length} · Entities: ${entities}\n\n`
    + `## Tiers\n${counts}\n\n## Folders\n`
    + TIERS.map((t) => `- [[${t}]]`).join("\n") + `\n- [[entities]]\n`;
  writeFileSync(join(vault, "_index", "MOC.md"), md);
}

// ── push: brain → vault (authoritative mirror, idempotent by content hash) ──
function pushBrainToVault(vault: string, dump: BrainDump, manifest: Manifest): SyncResult["push"] {
  let written = 0, skipped = 0;
  for (const m of dump.memories) {
    const mem: NoteMemory = { id: m.id, ns: m.ns, tier: m.tier, content: m.content, source: m.source, createdAt: m.createdAt, hits: m.hits };
    const h = contentHash(m.content);
    const file = join(vault, TIERS.includes(m.tier as any) ? m.tier : "working", noteFilename(m.id));
    if (manifest[m.id]?.brainHash === h && existsSync(file)) { skipped++; continue; }
    writeFileSync(file, toMarkdown(mem));
    manifest[m.id] = { brainHash: h, vaultHash: h };
    written++;
  }
  const entities = writeEntityNotes(vault, dump.facts);
  writeMoc(vault, dump, entities);
  return { written, skipped, entities };
}

// ── pull: vault → brain (human edits/new notes upsert into the store) ──
async function pullVaultToBrain(vault: string, manifest: Manifest, brainIds: Set<string>, remember: NonNullable<SyncOpts["remember"]>): Promise<SyncResult["pull"]> {
  let ingested = 0, skipped = 0, conflicts = 0;
  for (const tier of TIERS) {
    const dir = join(vault, tier);
    if (!existsSync(dir)) continue;
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith(".md")) continue;
      const parsed = parseMarkdown(readFileSync(join(dir, fname), "utf8"));
      if (!parsed.memory) { skipped++; continue; }
      const id = parsed.memory.id;
      const prev = manifest[id];
      const humanEdited = !prev || prev.vaultHash !== parsed.bodyHash;
      if (!humanEdited && brainIds.has(id)) { skipped++; continue; }
      // Conflict = brain content also moved since last sync while the note was hand-edited.
      if (prev && brainIds.has(id) && prev.brainHash !== contentHash(parsed.memory.content) && prev.vaultHash !== parsed.bodyHash) conflicts++;
      await remember({
        id, tier: parsed.memory.tier, content: parsed.memory.content,
        source: parsed.memory.source ?? "obsidian", ns: parsed.memory.ns,
        createdAt: parsed.memory.createdAt, hits: parsed.memory.hits,
      });
      manifest[id] = { brainHash: parsed.bodyHash, vaultHash: parsed.bodyHash };
      ingested++;
    }
  }
  return { ingested, skipped, conflicts };
}

export async function syncObsidian(direction: Direction = "both", opts: SyncOpts = {}): Promise<SyncResult> {
  const vault = opts.vault || defaultVaultPath();
  const dbPath = opts.dbPath || defaultDbPath();
  ensureDirs(vault);
  const manifest = loadManifest(vault);
  const remember = opts.remember || (async (m) => {
    const { brainRemember } = await import("./brain");
    return brainRemember(m as any);
  });

  let pull: SyncResult["pull"] = { ingested: 0, skipped: 0, conflicts: 0 };
  let push: SyncResult["push"] = { written: 0, skipped: 0, entities: 0 };

  // pull FIRST (ingest human edits) so the subsequent mirror can't clobber them.
  if (direction === "pull" || direction === "both") {
    const dump0 = exportBrain(dbPath);
    const brainIds = new Set(dump0.memories.map((m) => m.id));
    pull = await pullVaultToBrain(vault, manifest, brainIds, remember);
  }
  if (direction === "push" || direction === "both") {
    const dump = exportBrain(dbPath); // re-read: reflects anything pull just ingested
    push = pushBrainToVault(vault, dump, manifest);
  }

  saveManifest(vault, manifest);
  const memories = exportBrain(dbPath).memories.length;
  return { direction, push, pull, vault, memories };
}

export interface ObsidianStatus {
  vault: string;
  exists: boolean;
  notes: Record<string, number>;
  entities: number;
  brainMemories: number;
  drift: number; // brainMemories - total notes (unmirrored)
  conflicts: number;
  lastSync: number | null;
}

export function obsidianStatus(opts: SyncOpts = {}): ObsidianStatus {
  const vault = opts.vault || defaultVaultPath();
  const dbPath = opts.dbPath || defaultDbPath();
  const notes: Record<string, number> = {};
  let total = 0;
  const countDir = (d: string) => (existsSync(join(vault, d)) ? readdirSync(join(vault, d)).filter((f) => f.endsWith(".md")).length : 0);
  for (const t of TIERS) { notes[t] = countDir(t); total += notes[t]; }
  const entities = countDir("entities");
  const conflictsDir = join(vault, "_index", "conflicts");
  const conflicts = existsSync(conflictsDir) ? readdirSync(conflictsDir).filter((f) => f.endsWith(".md")).length : 0;
  let brainMemories = 0;
  try { brainMemories = exportBrain(dbPath).memories.length; } catch { /* db may be absent in fresh installs */ }
  let lastSync: number | null = null;
  try { lastSync = statSync(manifestPath(vault)).mtimeMs; } catch { /* never synced */ }
  return { vault, exists: existsSync(vault), notes, entities, brainMemories, drift: brainMemories - total, conflicts, lastSync };
}
