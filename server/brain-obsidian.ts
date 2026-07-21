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
  mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync,
} from "node:fs";
import { join } from "node:path";
import { exportBrain, neighborsFromDb, type BrainDump } from "./brain-portable";
import { toMarkdown, parseMarkdown, noteFilename, contentHash, TIERS, type NoteMemory } from "./brain-obsidian-note";

export function defaultVaultPath(): string {
  return process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`;
}
export function defaultDbPath(): string {
  return process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
}

// Bump when the note RENDER format changes (frontmatter fields, title/callout layout) so an
// upgrade re-materializes every note once, even when the underlying memory content is unchanged.
const RENDER_VERSION = "v2";
interface ManifestEntry { brainHash: string; vaultHash: string; tier?: string; linksHash?: string; rv?: string }
type Manifest = Record<string, ManifestEntry>;

interface SyncOpts {
  vault?: string;
  dbPath?: string;
  /** injected for tests — defaults to the real in-process brainRemember. */
  remember?: (m: { id: string; tier: any; content: string; source?: string; ns?: string; createdAt?: number; hits?: number }) => Promise<unknown>;
  /** injected for tests — memId → neighbor memIds; defaults to the live brainNeighbors. */
  neighbors?: () => Map<string, string[]>;
}
export type Direction = "both" | "push" | "pull";

export interface SyncResult {
  direction: Direction;
  push: { written: number; skipped: number; entities: number; pruned: number };
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

const entityBase = (label: string) => `entity-${noteFilename(label.toLowerCase().trim()).replace(/\.md$/, "")}`;
const memBase = (id: string) => noteFilename(id).replace(/\.md$/, "");

// Distinct entity labels (subjects+objects of live facts) → { basename, matchers }. Short
// labels (<4 chars) are dropped to avoid linking every note to "a"/"os"-type noise.
interface EntityIndex { labels: { lower: string; base: string }[] }
function buildEntityIndex(facts: BrainDump["facts"]): EntityIndex {
  const seen = new Set<string>();
  const labels: { lower: string; base: string }[] = [];
  for (const f of facts.filter((x) => x.invalidatedAt === null)) {
    for (const raw of [f.subject, f.object]) {
      const lower = raw.toLowerCase().trim();
      if (lower.length < 4 || seen.has(lower)) continue;
      seen.add(lower);
      labels.push({ lower, base: entityBase(raw) });
    }
  }
  return { labels };
}

/** entity notes mentioned in a memory's content (word-ish, case-insensitive), capped. */
function mentionsOf(content: string, idx: EntityIndex, cap = 8): string[] {
  const lc = content.toLowerCase();
  const out: string[] = [];
  for (const l of idx.labels) {
    if (lc.includes(l.lower)) { out.push(l.base); if (out.length >= cap) break; }
  }
  return out;
}

/** resolved link basenames for a memory note: nearest-neighbor memories + entity mentions. */
function linksFor(id: string, content: string, neighbors: Map<string, string[]>, idx: EntityIndex): string[] {
  const nb = (neighbors.get(id) || []).map(memBase);
  return [...new Set([...nb, ...mentionsOf(content, idx)])].sort();
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
    const self = `entity-${noteFilename(e.label.toLowerCase().trim()).replace(/\.md$/, "")}`;
    const links = e.edges
      .map((ed) => `- ${ed.predicate} → [[entity-${noteFilename(ed.object.toLowerCase().trim()).replace(/\.md$/, "")}]]`)
      .join("\n");
    // Enriched hub: alias (readable name in graph), degree (centrality), the fact edges, and
    // a Dataview "Mentioned in" that surfaces every memory linking here (backlink digest).
    const md = `---\ntype: entity\naliases: [${JSON.stringify(e.label)}]\nname: ${JSON.stringify(e.label)}\n`
      + `degree: ${e.edges.length}\ncssclasses: [brain, entity]\ntags: [entity]\n---\n\n`
      + `# ${e.label}\n\n> [!map] entity · degree ${e.edges.length}\n\n`
      + `## Facts\n${links || "_(no outgoing facts)_"}\n\n`
      + "## Mentioned in\n```dataview\nLIST FROM [[" + self + "]] WHERE type != \"entity\"\n```\n";
    writeFileSync(join(vault, "entities", `${self}.md`), md);
    written++;
  }
  return written;
}

// Per-tier graph node color (decimal RGB) — mirrors the ollamas dashboard palette so the
// Obsidian graph reads as tiered clusters, not a grey blob.
const TIER_RGB: Record<string, number> = {
  core: 0xffd700, learned: 0x00d4ff, procedural: 0x7b5ea7, episodic: 0x00c896, working: 0x8a9bb0,
};

// create-once: ship a beautiful default graph (color groups + plugins) but never clobber
// the user's own Obsidian tweaks on a later sync.
function writeObsidianConfig(vault: string): void {
  const dir = join(vault, ".obsidian");
  mkdirSync(dir, { recursive: true });
  const writeOnce = (name: string, content: string) => { const f = join(dir, name); if (!existsSync(f)) writeFileSync(f, content); };
  const colorGroups = [
    ...TIERS.map((t) => ({ query: `tag:#tier/${t}`, color: { a: 1, rgb: TIER_RGB[t] } })),
    { query: "tag:#entity", color: { a: 1, rgb: 0xf5a623 } },
  ];
  writeOnce("graph.json", JSON.stringify({
    collapse: false, search: "", showTags: true, showAttachments: false, hideUnresolved: false,
    showOrphans: true, collapseColorGroups: false, colorGroups,
    nodeSizeMultiplier: 1.1, lineSizeMultiplier: 1, centerStrength: 0.52,
    repelStrength: 12, linkStrength: 1, linkDistance: 250, scale: 0.6,
  }, null, 2));
  writeOnce("core-plugins.json", JSON.stringify(
    ["file-explorer", "global-search", "graph", "backlink", "outgoing-link", "tag-pane", "command-palette", "page-preview"], null, 2));
  writeOnce("app.json", JSON.stringify({ alwaysUpdateLinks: true, promptDelete: false, showFrontmatter: true }, null, 2));
  writeOnce("appearance.json", JSON.stringify({ theme: "obsidian", baseFontSize: 15, cssTheme: "", enabledCssSnippets: ["ollamas-brain"] }, null, 2));
  writeOnce("community-plugins.json", JSON.stringify([], null, 2));
  // CSS snippet: left-border accent per tier (cssclasses tier-*), so a note's colour matches
  // its graph node. Applies in reading + live-preview via the `.tier-*` body classes.
  mkdirSync(join(dir, "snippets"), { recursive: true });
  const hex: Record<string, string> = { core: "#ffd700", learned: "#00d4ff", procedural: "#7b5ea7", episodic: "#00c896", working: "#8a9bb0" };
  const css = "/* ollamas brain — tier accents (auto-generated) */\n"
    + TIERS.map((t) =>
        `.tier-${t} .view-content { border-left: 4px solid ${hex[t]}; }\n`
        + `.tier-${t} .inline-title, .tier-${t} h1:first-of-type { color: ${hex[t]}; }`).join("\n")
    + "\n.brain-home .view-content { border-left: 4px solid #f5a623; }\n";
  const snip = join(dir, "snippets", "ollamas-brain.css");
  if (!existsSync(snip)) writeFileSync(snip, css);
  writeOnce("README.md",
    "# ollamas brain vault\n\nAuto-mirrored from the ollamas sqlite-vec brain. Start at **[[Home]]** and open the\n"
    + "**Graph view** (Ctrl/Cmd+G) — nodes are colour-grouped by memory tier + entities.\n\n"
    + "For the dashboards on `Home` + `_index/tier-*` and the `_index/brain.base` database,\n"
    + "install the **Dataview** community plugin (Bases is core in Obsidian 1.9+). Without\n"
    + "Dataview the queries render as plain code blocks; everything else works unchanged.\n\n"
    + "Do not hand-delete notes to forget a memory — deletions are re-materialized from the\n"
    + "brain. Edit a note's body to update the memory (synced back within ~5 min).\n");
}

const dv = (q: string) => "```dataview\n" + q + "\n```";
const TIER_EMOJI: Record<string, string> = { core: "🟡", learned: "🔵", procedural: "🟣", episodic: "🟢", working: "⚪" };
const TIER_DESC: Record<string, string> = {
  core: "Kimlik + değişmez ilkeler (asla evict edilmez)",
  learned: "Damıtılmış dersler + kalıcı bilgi",
  procedural: "Nasıl-yapılır + kod/komut bilgisi",
  episodic: "Olaylar + oturum anıları (zamanla decay)",
  working: "Uçucu scratchpad (halka tampon)",
};

// Home.md — the vault's landing dashboard. Hero stats, tier navigation, an embedded Base
// view, and Dataview panels. Overwritten each sync (generated), unlike the .obsidian config.
function writeHome(vault: string, dump: BrainDump, entities: number): void {
  const count = (t: string) => dump.memories.filter((m) => m.tier === t).length;
  const md = `---\ncssclasses: [brain, brain-home]\ntags: [moc]\naliases: [Brain Home, ollamas brain]\n---\n\n`
    + `# 🧠 ollamas brain\n\n`
    + `> [!abstract] Canlı hafıza aynası\n`
    + `> **${dump.memories.length}** memory · **${dump.facts.length}** fact · **${entities}** entity · 5 katman\n\n`
    + `## Katmanlar\n`
    + TIERS.map((t) => `- ${TIER_EMOJI[t]} [[tier-${t}|${t}]] — **${count(t)}** · _${TIER_DESC[t]}_`).join("\n")
    + `\n- 🟠 [[entities|entities]] — **${entities}**\n\n`
    + `## 🗃️ Veritabanı görünümü\n![[brain.base]]\n\n`
    + `## 🕐 Son eklenenler\n`
    + dv("TABLE tier AS \"Katman\", hits AS \"Recall\", confidence AS \"Güven\"\nWHERE tier\nSORT created_ms DESC\nLIMIT 12")
    + `\n\n## 🔥 En çok hatırlananlar\n`
    + dv("TABLE tier AS \"Katman\", hits AS \"Recall\"\nWHERE hits > 5\nSORT hits DESC\nLIMIT 12")
    + `\n\n---\n*Dataview + Bases (Obsidian 1.9+ core) ile tam görünüm. Kurmadan da graf + linkler çalışır → [[README]].*\n`;
  writeFileSync(join(vault, "Home.md"), md);
}

// brain.base — an Obsidian Bases database over the memory notes: table/grouped/filtered
// views (Notion-like). Scoped to notes carrying a tier tag so entities/index notes are excluded.
function writeBase(vault: string): void {
  const tierFilter = TIERS.map((t) => `      - file.hasTag("tier/${t}")`).join("\n");
  const base = `filters:\n  or:\n${tierFilter}\n`
    + `properties:\n`
    + `  note.tier:\n    displayName: Katman\n`
    + `  note.hits:\n    displayName: Recall\n`
    + `  note.confidence:\n    displayName: Güven\n`
    + `  note.source:\n    displayName: Kaynak\n`
    + `views:\n`
    + `  - type: table\n    name: Tümü\n    order:\n      - file.name\n      - note.tier\n      - note.hits\n      - note.confidence\n      - note.source\n    limit: 200\n`
    + `  - type: table\n    name: Katman bazlı\n    groupBy: note.tier\n    order:\n      - file.name\n      - note.hits\n      - note.confidence\n`
    + `  - type: table\n    name: En çok recall\n    filters:\n      and:\n        - note.hits > 5\n    order:\n      - file.name\n      - note.tier\n      - note.hits\n    limit: 50\n`
    + `  - type: table\n    name: Yüksek güven\n    filters:\n      and:\n        - note.confidence >= 0.8\n    order:\n      - file.name\n      - note.tier\n      - note.confidence\n    limit: 50\n`
    + `  - type: cards\n    name: Working scratchpad\n    filters:\n      and:\n        - file.hasTag("tier/working")\n    order:\n      - file.name\n`;
  writeFileSync(join(vault, "_index", "brain.base"), base);
}

// Per-tier MOC hub notes — a landing page for each tier with a Dataview list + a link into
// the Base filtered to that tier. Replaces the bare folder links of the old MOC.
function writeTierIndexes(vault: string, dump: BrainDump): void {
  const count = (t: string) => dump.memories.filter((m) => m.tier === t).length;
  for (const t of TIERS) {
    const md = `---\ncssclasses: [brain, tier-${t}]\ntags: [moc]\naliases: [${t} tier]\n---\n\n`
      + `# ${TIER_EMOJI[t]} ${t} tier\n\n> [!info] ${TIER_DESC[t]}\n> **${count(t)}** memory · \`#tier/${t}\`\n\n`
      + `[[Home]] · [[brain.base]]\n\n## Notlar\n`
      + dv(`TABLE hits AS "Recall", confidence AS "Güven", source AS "Kaynak"\nFROM #tier/${t}\nSORT hits DESC, created_ms DESC\nLIMIT 100`)
      + "\n";
    writeFileSync(join(vault, "_index", `tier-${t}.md`), md);
  }
}

// ── push: brain → vault (authoritative mirror, idempotent by content hash) ──
// pruneUntracked: when pull already ran this cycle (both-mode), every human note is
// already in the brain, so ANY note absent from the brain is a genuine orphan and safe
// to drop even without a manifest entry (covers pre-manifest legacy notes). push-only
// keeps the conservative manifest guard so an un-pulled human note is never deleted.
function pushBrainToVault(vault: string, dump: BrainDump, manifest: Manifest, neighbors: Map<string, string[]>, entityIdx: EntityIndex, pruneUntracked = false): SyncResult["push"] {
  let written = 0, skipped = 0;
  for (const m of dump.memories) {
    const mem: NoteMemory = { id: m.id, ns: m.ns, tier: m.tier, content: m.content, source: m.source, createdAt: m.createdAt, hits: m.hits, actor: m.actor, confidence: m.confidence };
    const h = contentHash(m.content);
    const links = linksFor(m.id, m.content, neighbors, entityIdx);
    const lh = contentHash(links.join("|"));
    const tier = TIERS.includes(m.tier as any) ? m.tier : "working";
    const noteName = noteFilename(m.id);
    const prev = manifest[m.id];
    // Tier moved (episodic→learned promote, etc.) or a legacy entry with no recorded tier:
    // sweep the same-id note out of every OTHER tier folder so one memory = exactly one
    // note (else a promoted memory leaves a stale duplicate in its old tier).
    if (!prev || prev.tier !== tier) {
      for (const t of TIERS) if (t !== tier) { const f = join(vault, t, noteName); if (existsSync(f)) rmSync(f); }
    }
    const file = join(vault, tier, noteName);
    // Skip only when BOTH content and links are unchanged — so the first enrich pass (no
    // linksHash yet) rewrites every note with its [[wikilinks]], and later neighbour drift
    // re-renders just the affected notes.
    if (prev?.brainHash === h && prev?.linksHash === lh && prev?.tier === tier && prev?.rv === RENDER_VERSION && existsSync(file)) { skipped++; continue; }
    writeFileSync(file, toMarkdown(mem, links));
    manifest[m.id] = { brainHash: h, vaultHash: h, tier, linksHash: lh, rv: RENDER_VERSION };
    written++;
  }
  // Prune orphan notes: a memory CONSOLIDATED out of the brain (dedup/merge/evict) leaves
  // a stale note. brain is the source of truth for EXISTENCE, so its note is safe to drop —
  // distinct from a hand-DELETED note (re-materialized above). Two guards prevent data loss:
  //   1. never prune when the dump is empty (a failed export must not wipe the vault)
  //   2. only prune notes WE wrote (id present in the manifest) — a human-authored note
  //      not yet pulled has no manifest entry and is left untouched.
  let pruned = 0;
  const liveIds = new Set(dump.memories.map((m) => m.id));
  if (liveIds.size > 0) {
    for (const tier of TIERS) {
      const dir = join(vault, tier);
      if (!existsSync(dir)) continue;
      for (const fname of readdirSync(dir)) {
        if (!fname.endsWith(".md")) continue;
        const id = parseMarkdown(readFileSync(join(dir, fname), "utf8")).memory?.id;
        if (id && !liveIds.has(id) && (manifest[id] || pruneUntracked)) { rmSync(join(dir, fname)); delete manifest[id]; pruned++; }
      }
    }
  }
  const entities = writeEntityNotes(vault, dump.facts);
  writeHome(vault, dump, entities);
  writeBase(vault);
  writeTierIndexes(vault, dump);
  return { written, skipped, entities, pruned };
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
  let push: SyncResult["push"] = { written: 0, skipped: 0, entities: 0, pruned: 0 };

  // pull FIRST (ingest human edits) so the subsequent mirror can't clobber them.
  if (direction === "pull" || direction === "both") {
    const dump0 = exportBrain(dbPath);
    const brainIds = new Set(dump0.memories.map((m) => m.id));
    pull = await pullVaultToBrain(vault, manifest, brainIds, remember);
  }
  if (direction === "push" || direction === "both") {
    const dump = exportBrain(dbPath); // re-read: reflects anything pull just ingested
    // Density sources: memory→memory nearest neighbors (stored-vector KNN, no re-embed) +
    // memory→entity mentions. Injectable for tests; defaults to the live brain.
    const neighbors = opts.neighbors ? opts.neighbors() : neighborsFromDb(dbPath, 5);
    const entityIdx = buildEntityIndex(dump.facts);
    push = pushBrainToVault(vault, dump, manifest, neighbors, entityIdx, direction === "both");
    writeObsidianConfig(vault); // create-once: graph color-groups, plugins, appearance
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
