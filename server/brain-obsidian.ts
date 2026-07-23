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
import { writeEcymNotes, writeEcymLearningQueue, readApprovedLearning, bridgeApprovedToMisses, ecymDatasetPath, writeEcymBase, writeEcymHub, ecymSplit, readEcymCommands } from "./brain-obsidian-ecym";
import { writeOdysseusNotes } from "./brain-obsidian-khoj";
import { toMarkdown, parseMarkdown, noteFilename, contentHash, adoptHumanNote, ROOT_RESERVED, TIERS, type NoteMemory } from "./brain-obsidian-note";
import { syncAudio, type AudioSyncResult } from "./brain-obsidian-audio";
import { readOutcomes, orchestraPanel, renderPanel } from "./orchestra-status";
import { parseBoard } from "./orchestra-tasks";
import { ROLE_CARDS } from "./orchestra-roles";

export function defaultVaultPath(): string {
  return process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`;
}
export function defaultDbPath(): string {
  return process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
}

// Bump when the note RENDER format changes (frontmatter fields, title/callout layout) so an
// upgrade re-materializes every note once, even when the underlying memory content is unchanged.
const RENDER_VERSION = "v3";
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
  push: { written: number; skipped: number; entities: number; pruned: number; adopted?: number };
  pull: { ingested: number; skipped: number; conflicts: number };
  /** L28 voice-memo transcription outcome for this run (absent on push-only). */
  audio?: AudioSyncResult;
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
  mkdirSync(join(vault, "inbox"), { recursive: true }); // L27: the human capture drop zone
  mkdirSync(join(vault, "entities"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  mkdirSync(join(vault, "_index", "conflicts"), { recursive: true });
}

// Orchestra origin of an ollamas memory (weakly derivable — see FAZ-7 investigation). Most
// memories are ollamas-authored; a few carry an odysseus actor. eCym has its own store.
function systemOf(source: string | null, actor: string | null): string {
  const s = `${source || ""} ${actor || ""}`.toLowerCase();
  if (s.includes("odysseus")) return "odysseus";
  if (s.includes("claude")) return "claudecode";
  if (s.includes("ecym") || s.includes("ecy-")) return "ecym";
  return "ollamas";
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
    // orchestra systems first (broadest) so tier tints layer on top in the graph legend
    { query: "tag:#system/ecym", color: { a: 1, rgb: SYSTEM_RGB.ecym } },
    { query: "tag:#system/odysseus", color: { a: 1, rgb: SYSTEM_RGB.odysseus } },
    { query: "tag:#system/claudecode", color: { a: 1, rgb: SYSTEM_RGB.claudecode } },
    { query: "tag:#orchestra", color: { a: 1, rgb: SYSTEM_RGB.orchestra } },
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
  // L21: bookmarks — pin the key navigation surfaces so the vault opens finished.
  writeOnce("bookmarks.json", JSON.stringify({ items: [
    { type: "file", path: "Home.md", title: "🧠 Home" },
    { type: "file", path: "orchestra/Orchestra.md", title: "🎼 Orchestra" },
    { type: "file", path: "orchestra.canvas", title: "🎼 Orchestra map" },
    { type: "file", path: "entity-map.canvas", title: "🗺️ Entity map" },
    { type: "file", path: "_index/brain.base", title: "🗃️ Brain DB" },
  ] }, null, 2));
  // CSS snippet: left-border accent per tier (cssclasses tier-*), so a note's colour matches
  // its graph node. Applies in reading + live-preview via the `.tier-*` body classes.
  mkdirSync(join(dir, "snippets"), { recursive: true });
  const hex: Record<string, string> = { core: "#ffd700", learned: "#00d4ff", procedural: "#7b5ea7", episodic: "#00c896", working: "#8a9bb0" };
  const sysHex: Record<string, string> = { ollamas: "#00d4ff", ecym: "#00c896", odysseus: "#7b5ea7", orchestra: "#ffd700" };
  const css = "/* ollamas brain — tier + system accents (auto-generated) */\n"
    + TIERS.map((t) =>
        `.tier-${t} .view-content { border-left: 4px solid ${hex[t]}; }\n`
        + `.tier-${t} .inline-title, .tier-${t} h1:first-of-type { color: ${hex[t]}; }`).join("\n")
    + "\n" + Object.entries(sysHex).map(([s, c]) =>
        `.system-${s} .view-header { border-top: 3px solid ${c}; }`).join("\n")
    + "\n.brain-home .view-content, .system-orchestra .view-content { border-left: 4px solid #ffd700; }\n";
  const snip = join(dir, "snippets", "ollamas-brain.css");
  if (!existsSync(snip)) writeFileSync(snip, css);
  // L28: the CORE daily-notes plugin defaults its folder to the vault ROOT, which is how
  // `2026-07-22.md` appeared next to Home.md. Left alone it re-litters the root every day and
  // fights periodic-notes for the same file. Point both at journal/ with one format.
  writeOnce("daily-notes.json", JSON.stringify(
    { folder: "journal", format: "YYYY-MM-DD", template: "templates/daily.md" }, null, 2));
  // L25: per-plugin settings for the runtime installed by scripts/obsidian-plugins.ts.
  // create-once as well — Obsidian owns these files once the user touches a settings tab.
  // Only plugins whose defaults would MISS our generated layout are configured; the rest
  // ship sane defaults. obsidian-git is intentionally left un-configured until L32, and
  // local-rest-api mints its own API key on first load (consumed in L26).
  const pluginSettings: Record<string, unknown> = {
    // Journals live in journal/ as YYYY-MM-DD; weekly rollups land there too (L31).
    "periodic-notes": {
      daily: { format: "YYYY-MM-DD", folder: "journal", template: "templates/daily.md", enabled: true },
      weekly: { format: "[weekly-]GGGG-[W]WW", folder: "journal", template: "", enabled: true },
    },
    calendar: { shouldConfirmBeforeCreate: false, weekStart: "monday" },
    // Inline queries power the compact stats on Home; JS queries stay OFF (they execute
    // arbitrary code from note bodies, and the brain writes those bodies).
    dataview: { enableDataviewJs: false, enableInlineDataviewJs: false, enableInlineDataview: true, refreshEnabled: true },
    "templater-obsidian": { templates_folder: "templates", trigger_on_file_creation: false },
  };
  for (const [id, cfg] of Object.entries(pluginSettings)) {
    const pdir = join(dir, "plugins", id);
    // Only write next to a plugin that is actually installed — never conjure an empty dir.
    if (!existsSync(pdir)) continue;
    const f = join(pdir, "data.json");
    if (!existsSync(f)) writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n");
  }
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
function writeHome(vault: string, dump: BrainDump, entities: number, ecymCount = 0): void {
  const count = (t: string) => dump.memories.filter((m) => m.tier === t).length;
  const staleMoc = join(vault, "_index", "MOC.md"); // FAZ-4 leftover, superseded by Home.md
  if (existsSync(staleMoc)) rmSync(staleMoc);
  const md = `---\ncssclasses: [brain, brain-home]\ntags: [moc]\naliases: [Brain Home, ollamas brain]\n---\n\n`
    + `# 🧠 ollamas brain\n\n`
    + `> [!abstract] Canlı hafıza aynası\n`
    + `> **${dump.memories.length}** memory · **${dump.facts.length}** fact · **${entities}** entity · 5 katman\n\n`
    + `## 🎼 Orkestra\n> [!example] ollamas + eCym + odysseus tek beyin\n`
    + `> [[Orchestra]] — 3-sistem hub + Canvas · [[council]] — ödül defteri · 🟢 [[eCym]] ${ecymCount} komut\n\n`
    + `## Katmanlar\n`
    + TIERS.map((t) => `- ${TIER_EMOJI[t]} [[tier-${t}|${t}]] — **${count(t)}** · _${TIER_DESC[t]}_`).join("\n")
    + `\n- 🟠 [[entities|entities]] — **${entities}**\n\n`
    + `## 🗃️ Veritabanı görünümü\n![[brain.base]]\n\n`
    + `## 🗺️ Görsel haritalar\n[[orchestra.canvas|Orkestra akışı]] · [[entity-map.canvas|Bilgi haritası]]\n\n`
    + `## 🧭 Keşif\n[[hubs|🕸️ Merkez düğümler]] · [[review|🔁 Gözden-geçir]] · [[namespaces|🗂️ Namespace'ler]] · 📆 rollup: \`journal/weekly\` · \`journal/monthly\`\n\n`
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
    + `formulas:\n  recall_rank: 'if(note.hits > 10, "🔥 hot", if(note.hits > 3, "warm", "cold"))'\n`
    + `properties:\n`
    + `  note.tier:\n    displayName: Katman\n`
    + `  note.hits:\n    displayName: Recall\n`
    + `  note.confidence:\n    displayName: Güven\n`
    + `  note.source:\n    displayName: Kaynak\n`
    + `views:\n`
    + `  - type: table\n    name: Tümü\n    order:\n      - file.name\n      - note.tier\n      - note.hits\n      - note.confidence\n      - note.source\n    limit: 200\n`
    // groupBy must be an OBJECT carrying both property and direction. Obsidian's own parser
    // (obsidian.asar) throws "groupBy bir object olmalıdır" otherwise, and a base that throws
    // is unqueryable — `obsidian base:query file=brain.base` failed on every run before this.
    // The bare scalar form that shipped here silently broke two of the six views.
    + `  - type: table\n    name: Katman bazlı\n    groupBy:\n      property: note.tier\n      direction: ASC\n    order:\n      - file.name\n      - note.hits\n      - note.confidence\n`
    + `  - type: table\n    name: En çok recall\n    filters:\n      and:\n        - note.hits > 5\n    order:\n      - file.name\n      - note.tier\n      - note.hits\n    limit: 50\n`
    + `  - type: table\n    name: Yüksek güven\n    filters:\n      and:\n        - note.confidence >= 0.8\n    order:\n      - file.name\n      - note.tier\n      - note.confidence\n    limit: 50\n`
    + `  - type: cards\n    name: Working scratchpad\n    filters:\n      and:\n        - file.hasTag("tier/working")\n    order:\n      - file.name\n`
    + `  - type: table\n    name: Sistem bazlı\n    groupBy:\n      property: note.system\n      direction: ASC\n    order:\n      - file.name\n      - note.tier\n      - note.hits\n      - formula.recall_rank\n`;
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

// L18: entity-map.canvas — a visual knowledge map of the top-degree fact-graph entities.
// Nodes sized by degree, laid out on a grid; edges are the live facts among them. Native
// JSON Canvas (no plugin). Complements orchestra.canvas (systems) with the knowledge graph.
function writeEntityMapCanvas(vault: string, facts: BrainDump["facts"]): number {
  const live = facts.filter((f) => f.invalidatedAt === null);
  const deg = new Map<string, number>();
  const label = new Map<string, string>();
  for (const f of live) for (const raw of [f.subject, f.object]) {
    const k = raw.toLowerCase().trim(); if (!k) continue;
    deg.set(k, (deg.get(k) || 0) + 1); if (!label.has(k)) label.set(k, raw);
  }
  const top = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const topSet = new Set(top.map(([k]) => k));
  const idOf = (k: string) => `e_${noteFilename(k).replace(/\.md$/, "")}`;
  const cols = 6;
  const nodes = top.map(([k, d], i) => {
    const size = Math.min(70 + d * 6, 200);
    return { id: idOf(k), type: "file" as const, file: `entities/entity-${noteFilename(k).replace(/\.md$/, "")}.md`,
      x: (i % cols) * 320, y: Math.floor(i / cols) * 240, width: size, height: 80,
      color: String(((d % 6) + 1)) };
  });
  const edges: any[] = [];
  let ei = 0;
  for (const f of live) {
    const s = f.subject.toLowerCase().trim(), o = f.object.toLowerCase().trim();
    if (topSet.has(s) && topSet.has(o) && s !== o && ei < 120) {
      edges.push({ id: `me${ei++}`, fromNode: idOf(s), toNode: idOf(o), label: f.predicate.slice(0, 24) });
    }
  }
  writeFileSync(join(vault, "entity-map.canvas"), JSON.stringify({ nodes, edges }, null, 2));
  return nodes.length;
}

// Templater-compatible note templates (create-once) so hand-added notes match the schema.
function writeTemplates(vault: string): void {
  const dir = join(vault, "templates");
  mkdirSync(dir, { recursive: true });
  const once = (name: string, body: string) => { const f = join(dir, name); if (!existsSync(f)) writeFileSync(f, body); };
  once("memory.md", `---\nid: manual:<% tp.date.now("YYYYMMDDHHmmss") %>\nsystem: ollamas\nns: manual\ntier: learned\nsource: obsidian\ncreated: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>\nconfidence: 0.85\ncssclasses: [brain, tier-learned, system-ollamas]\ntags: [tier/learned, ns/manual, system/ollamas]\n---\n\n# <% tp.file.title %>\n\n> [!abstract] learned · manual\n\n`);
  once("daily.md", `---\ncssclasses: [brain]\ntags: [journal]\n---\n\n# <% tp.file.title %>\n\n## Bugün öğrenilenler\n\`\`\`dataview\nLIST FROM #tier/episodic WHERE created_ms\n\`\`\`\n`);
  // eCym command draft. The catalog notes carry level/safe/id, so a new command written by
  // hand should start with the same shape — otherwise it will not show up in ecym.base. `safe`
  // defaults to false: a command is gated until someone decides it isn't, never the reverse.
  once("ecym-command.md", `---\nid: "ecym:<% tp.file.title %>"\nsystem: ecym\nlevel: baslangic\nsafe: false\ncssclasses: [brain, system-ecym]\ntags: [system/ecym, ecym/baslangic, ecym/gated]\naliases: []\n---\n\n# <% tp.file.title %>\n\n> [!warning] eCym · baslangic · gated\n\n\`\`\`bash\n\n\`\`\`\n`);
}

// Daily-note journal: episodic memories grouped by day → journal/YYYY-MM-DD.md (Calendar-
// plugin compatible). Each day lists links to that day's episodic notes.
function writeJournal(vault: string, dump: BrainDump): number {
  const dir = join(vault, "journal");
  mkdirSync(dir, { recursive: true });
  const byDay = new Map<string, string[]>();
  for (const m of dump.memories) {
    if (m.tier !== "episodic") continue;
    const day = new Date(m.createdAt).toISOString().slice(0, 10);
    (byDay.get(day) || byDay.set(day, []).get(day)!).push(memBase(m.id));
  }
  const days = [...byDay.keys()];
  const live = new Set(days.map((d) => `${d}.md`));
  for (const [day, ids] of byDay) {
    const links = [...new Set(ids)].sort().map((b) => `- [[${b}]]`).join("\n");
    writeFileSync(join(dir, `${day}.md`),
      `---\ncssclasses: [brain]\ntags: [journal]\naliases: [${day}]\n---\n\n# 📅 ${day}\n\n> [!quote] ${ids.length} episodic anı\n\n${links}\n`);
  }
  if (live.size > 0) for (const f of readdirSync(dir)) if (f.endsWith(".md") && !live.has(f)) rmSync(join(dir, f));
  // L26: periodic rollups — world-class second-brains summarise by week + month, not just day.
  writePeriodicRollup(dir, "weekly", byDay, isoWeek);
  writePeriodicRollup(dir, "monthly", byDay, (d) => d.slice(0, 7));
  return days.length;
}

// ISO-8601 week key (YYYY-Www) for a YYYY-MM-DD day string.
function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const th = new Date(d); th.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // nearest Thursday
  const yStart = new Date(Date.UTC(th.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((th.getTime() - yStart.getTime()) / 86400000 + 1) / 7);
  return `${th.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

// L26: roll daily episodic counts up into journal/<period>/<key>.md (week or month) with a
// day-by-day breakdown + total. Pruned like the daily notes so removed history disappears.
function writePeriodicRollup(journalDir: string, period: "weekly" | "monthly", byDay: Map<string, string[]>, keyOf: (day: string) => string): void {
  const dir = join(journalDir, period);
  mkdirSync(dir, { recursive: true });
  const byKey = new Map<string, { day: string; n: number }[]>();
  for (const [day, ids] of byDay) {
    const k = keyOf(day);
    (byKey.get(k) || byKey.set(k, []).get(k)!).push({ day, n: new Set(ids).size });
  }
  const live = new Set([...byKey.keys()].map((k) => `${k}.md`));
  for (const [k, rows] of byKey) {
    rows.sort((a, b) => a.day.localeCompare(b.day));
    const total = rows.reduce((s, r) => s + r.n, 0);
    const list = rows.map((r) => `- [[${r.day}]] — ${r.n} anı`).join("\n");
    const icon = period === "weekly" ? "🗓️" : "📆";
    writeFileSync(join(dir, `${k}.md`),
      `---\ncssclasses: [brain]\ntags: [journal, journal/${period}]\naliases: [${k}]\n---\n\n# ${icon} ${k}\n\n> [!abstract] ${total} episodic anı · ${rows.length} gün\n\n${list}\n\n[[Home]]\n`);
  }
  if (live.size > 0) for (const f of readdirSync(dir)) if (f.endsWith(".md") && !live.has(f)) rmSync(join(dir, f));
}

// L26: hub notes — surface the most-connected memories (graph centrality by neighbor degree).
// A world-class vault has "maps of content" anchored on its densest nodes; this derives them
// from the same neighbor data the notes already link by.
function writeHubs(vault: string, dump: BrainDump, neighbors: Map<string, string[]>): void {
  const byId = new Map(dump.memories.map((m) => [m.id, m]));
  const ranked = [...neighbors.entries()]
    .map(([id, nb]) => ({ id, deg: nb.length, m: byId.get(id) }))
    .filter((r) => r.m && r.deg > 0)
    .sort((a, b) => b.deg - a.deg)
    .slice(0, 20);
  const rows = ranked.map((r) => `- [[${memBase(r.id)}]] — **${r.deg}** bağ · \`${r.m!.tier}\` · ${r.m!.hits ?? 0}× recall`).join("\n");
  writeFileSync(join(vault, "_index", "hubs.md"),
    `---\ncssclasses: [brain]\ntags: [moc]\naliases: [Hubs, Merkez düğümler]\n---\n\n# 🕸️ Merkez düğümler (en-bağlı anılar)\n\n`
    + `> [!info] Graf-merkezliliği en yüksek ${ranked.length} anı — beynin ana kavşakları. [[Home]]\n\n${rows || "_(henüz bağ yok)_"}\n`);
}

// L26: review queue — high-value (often-recalled) but ageing memories, surfaced for a
// spaced-repetition-style review. Read-only suggestion; never mutates the brain.
function writeReviewQueue(vault: string, dump: BrainDump): void {
  const now = Date.now();
  const AGE = 30 * 86400000; // 30 gün
  const stale = dump.memories
    .filter((m) => (m.hits ?? 0) >= 3 && now - m.createdAt > AGE && m.tier !== "episodic")
    .sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0))
    .slice(0, 25);
  const rows = stale.map((m) => {
    const days = Math.floor((now - m.createdAt) / 86400000);
    return `- [[${memBase(m.id)}]] — ${m.hits ?? 0}× · ${days}g önce · \`${m.tier}\``;
  }).join("\n");
  writeFileSync(join(vault, "_index", "review.md"),
    `---\ncssclasses: [brain]\ntags: [moc]\naliases: [Review, Gözden geçir]\n---\n\n# 🔁 Gözden-geçirme kuyruğu\n\n`
    + `> [!tip] Sık-kullanılan ama eskiyen ${stale.length} anı (≥3 recall · >30g). Doğrula/güncelle. [[Home]]\n\n${rows || "_(kuyruk boş)_"}\n`);
}

/**
 * L29 — the recall dashboard. These Dataview blocks were dead code fences until L25 installed
 * the plugin; now they are live tables over the frontmatter every note already carries.
 * `neighbours` is passed in rather than recomputed: the push step already did the KNN.
 */
function writeRecallIndex(vault: string, dump: BrainDump, neighbors: Map<string, string[]>): void {
  const orphans = dump.memories.filter((m) => !(neighbors.get(m.id) || []).length);
  const lowConf = dump.memories.filter((m) => typeof m.confidence === "number" && (m.confidence as number) < 0.6);
  const list = (rows: typeof dump.memories, n = 15) =>
    rows.slice(0, n).map((m) => `- [[${memBase(m.id)}]] · \`${m.tier}\``).join("\n") || "_(yok)_";
  writeFileSync(join(vault, "_index", "recall.md"),
    `---\ncssclasses: [brain]\ntags: [moc]\naliases: [Recall, Hatırlama]\n---\n\n`
    + `# 🔎 Hatırlama panosu\n\n> [!tip] Soru sormak için [[search]] · sentez için [[ask]]. [[Home]]\n\n`
    + `## 🔥 En çok hatırlananlar\n`
    + "```dataview\nTABLE tier AS \"Katman\", hits AS \"Recall\", confidence AS \"Güven\"\nWHERE hits > 3\nSORT hits DESC\nLIMIT 20\n```\n\n"
    + `## ⚠️ Düşük güven (<0.6) — **${lowConf.length}**\n`
    + "```dataview\nTABLE tier AS \"Katman\", confidence AS \"Güven\", source AS \"Kaynak\"\nWHERE confidence AND confidence < 0.6\nSORT confidence ASC\nLIMIT 20\n```\n\n"
    + `## 🝟 Yetim (komşusuz) — **${orphans.length}**\n`
    + `_Hiçbir anıya yeterince benzemeyen kayıtlar; ya çok özgün ya da gürültü._\n\n${list(orphans)}\n\n`
    + `## 🎙️ Ses kaynaklı\n`
    + "```dataview\nTABLE tier AS \"Katman\", created AS \"Tarih\"\nWHERE contains(source, \"voice/\")\nSORT created DESC\n```\n");
}

// Namespace index — a hub grouping memories by ns (the brain's logical partitions).
function writeNamespaceIndex(vault: string, dump: BrainDump): void {
  const byNs = new Map<string, number>();
  for (const m of dump.memories) byNs.set(m.ns, (byNs.get(m.ns) || 0) + 1);
  const rows = [...byNs.entries()].sort((a, b) => b[1] - a[1]).map(([ns, n]) => `- \`ns/${ns}\` — **${n}**`).join("\n");
  writeFileSync(join(vault, "_index", "namespaces.md"),
    `---\ncssclasses: [brain]\ntags: [moc]\naliases: [Namespaces]\n---\n\n# 🗂️ Namespace'ler\n\n[[Home]]\n\n${rows}\n\n`
    + "```dataview\nTABLE length(rows) AS \"Count\"\nWHERE ns\nGROUP BY ns\n```\n");
}

// System palette (decimal RGB for the graph, hex for CSS, canvas color codes).
const SYSTEM_RGB: Record<string, number> = { ollamas: 0x00d4ff, ecym: 0x00c896, odysseus: 0x7b5ea7, claudecode: 0xff6b6b, orchestra: 0xffd700 };
const COUNCIL_SEATS: Record<string, number> = { ecy: 0.30, ollamas: 0.25, odysseus: 0.23, claudecode: 0.22 };

// ── Orchestra federation: the 3-system whole (ollamas + eCym + odysseus) + council history ──
// Mirrors the council ledger (~/.ollamas/council-ledger.json) + a hub note + a visual Canvas.
function writeOrchestra(vault: string, dump: BrainDump, ecymCount: number, obsidianUp = false, obsidianTools = 0): void {
  const dir = join(vault, "orchestra");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "answers"), { recursive: true });
  // L9: ask queue (create-once so human questions survive re-sync). The sync loop reads
  // `- [ ]` lines, asks ask-shared, writes answers/, marks `- [x]`.
  const askPath = join(dir, "ask.md");
  if (!existsSync(askPath)) writeFileSync(askPath,
    `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra]\naliases: [Ask, Sor]\n---\n\n`
    + `# 🎤 Orkestra'ya sor\n\n> [!tip] Bir satır ekle: \`- [ ] sorun\` → ~5 dk içinde ask-shared cevaplar → [[answers]] klasörü + \`- [x]\` işaretlenir.\n\n`
    + `- [ ] <sorunu buraya yaz>\n`);
  // L29: recall queue. Distinct from ask.md on purpose — ask.md spends four experts to
  // SYNTHESISE an answer; this one just retrieves, and shows the semantic and lexical
  // channels side by side so you can see which one found what.
  const searchPath = join(dir, "search.md");
  if (!existsSync(searchPath)) writeFileSync(searchPath,
    `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra]\naliases: [Search, Ara]\n---\n\n`
    + `# 🔎 Hafızada ara\n\n> [!tip] \`- [ ] arama\` satırı ekle → brain anlamsal recall + Obsidian sözcüksel arama → [[answers]] · \`- [x]\` işaretlenir.\n`
    + `> Sentezlenmiş cevap istiyorsan [[ask]] kullan; burası ham kaynakları getirir.\n\n`
    + `- [ ] <aramanı buraya yaz>\n`);
  let ledger: any = null;
  try { ledger = JSON.parse(readFileSync(`${process.env.HOME}/.ollamas/council-ledger.json`, "utf8")); } catch { /* no council yet */ }

  // council.md — the orchestra-run history (rewards, seats, recent verdicts).
  const rewards = ledger?.rewards || {};
  const rewardRows = Object.entries(rewards).map(([o, v]) => `| ${o} | ${(v as number).toFixed?.(2) ?? v} | ${((COUNCIL_SEATS[o] ?? 0) * 100).toFixed(0)}% |`).join("\n");
  const history = Array.isArray(ledger?.history) ? ledger.history.slice(-20).reverse() : [];
  const histRows = history.map((h: any) => `| ${String(h.winner || "?")} | ${String(h.task || "").slice(0, 60).replace(/\|/g, "/")} | ${h.bestScore ?? ""} |`).join("\n");
  const council = `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, council]\naliases: [Council, Konsey]\n---\n\n`
    + `# 🏛️ Council — orkestra ödül defteri\n\n`
    + `> [!success] ${ledger?.tasks ?? 0} tamamlanan görev · seviye ${ledger?.level ?? "?"} (${ledger?.level_name ?? ""}) · toplam ödül ${ledger?.total_reward ?? 0}\n\n`
    + `## Koltuklar & ödüller\n| Üye | Ödül | Ağırlık |\n|---|---|---|\n${rewardRows || "| — | — | — |"}\n\n`
    + `## Son kararlar (20)\n| Kazanan | Görev | Skor |\n|---|---|---|\n${histRows || "| — | — | — |"}\n\n`
    + `[[Orchestra]] · kaynak: \`~/.ollamas/council-ledger.json\` (read-only mirror)\n`;
  writeFileSync(join(dir, "council.md"), council);

  // Orchestra.md — the hub: 3 systems, ask-shared MoE flow (mermaid), council, canvas.
  const memCount = dump.memories.length;
  const hub = `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, moc]\naliases: [Orchestra, Orkestra]\n---\n\n`
    + `# 🎼 Orkestra — ollamas · eCym · odysseus\n\n`
    + `> [!abstract] Tek retrieval → 3 uzman → MoE gate → kazanan (ask-shared). Council ödül-defteriyle öğrenir.\n\n`
    + `![[orchestra.canvas]]\n\n`
    + `## Sistemler\n`
    + `> [!info]+ 🔵 **ollamas** — sovereign brain + MCP gateway (:3000)\n> ${memCount} memory · sqlite-vec · ask-shared retrieval sahibi · [[Home]]\n\n`
    + `> [!tip]+ 🟢 **eCym** — $0 yerel komut-uzmanı (qwen3:8b)\n> ${ecymCount} komut (\`ecym/\` klasörü) · triggers→intent → cmd\n\n`
    + `> [!note]+ 🟣 **odysseus** — deterministik araştırma/generation uzmanı (:7860)\n> kendi store'u yok (harici Khoj); council-koltuğu + ask-shared uzmanı\n\n`
    + `> [!danger]+ 🔴 **claudecode** — kod/PR/refactor uzmanı (github-models, keyless)\n> ask-shared 4. uzmanı + council-koltuğu (%22); soğuk-başlangıç → gate ledger'dan kalibre\n\n`
    // L36: obsidian is a MEMBER, not the stage. It is not an ask-shared seat (adding one would
    // resize the gate); it holds a ROLE — the only member that sees resolved backlinks and can
    // write human-facing notes. Health is probed live, so a closed app reads as offline.
    + `> [!warning]+ 🟠 **obsidian** — kasa (Local REST + MCP :27124)\n> ${obsidianTools} canlı araç · ${obsidianUp ? "🟢 çevrimiçi" : "🔴 çevrimdışı"} · çözümlenmiş backlink + etiket indeksi; vault'a YAZABİLEN tek üye\n\n`
    + `## Roller — klon değil, uzman\n`
    + ROLE_CARDS.map((c) => `- **${c.title}** — ${c.capability}\n  _${c.unique}_`).join("\n") + `\n\n`
    + `## ask-shared akışı\n\`\`\`mermaid\nflowchart LR\n  Q[Soru] --> R[(brain retrieval)]\n  R --> O[🔵 ollamas]\n  R --> E[🟢 eCym]\n  R --> D[🟣 odysseus]\n  R --> C[🔴 claudecode]\n  O --> G{MoE gate w_j}\n  E --> G\n  D --> G\n  C --> G\n  G --> A[✅ p_final]\n\`\`\`\n\n`
    + `[[runs|Son ask-shared koşuları]] · [[status|Canlı durum]]\n\n`
    + `## Konsey\n[[council]] — koltuklar: `
    + Object.entries(COUNCIL_SEATS).map(([o, w]) => `${o} ${(w * 100).toFixed(0)}%`).join(" · ")
    + `\n`;
  writeFileSync(join(dir, "Orchestra.md"), hub);

  // orchestra.canvas — JSON Canvas visual board (native Obsidian core, no plugin).
  const node = (id: string, text: string, x: number, y: number, color: string, w = 240, h = 100) =>
    ({ id, type: "text", text, x, y, width: w, height: h, color });
  const canvas = {
    nodes: [
      node("q", "## ❓ Soru\nask-shared / council girişi", -560, -40, "6"),
      node("retr", "## 🧠 brain retrieval\n" + memCount + " memory · sqlite-vec (q*)", -260, -40, "5"),
      node("ollamas", "## 🔵 ollamas\nsovereign brain + MCP :3000", 120, -280, "5"),
      node("ecym", "## 🟢 eCym\n" + ecymCount + " komut · $0 qwen3:8b", 120, -100, "4"),
      node("odysseus", "## 🟣 odysseus\nresearch/generation :7860", 120, 80, "6"),
      node("claudecode", "## 🔴 claudecode\nkod/PR/refactor · github-models", 120, 260, "1"),
      node("gate", "## ⚖️ MoE gate\nw_j = softmax(W_g·q) · 4 uzman", 480, -100, "3"),
      node("final", "## ✅ p_final\nkazanan uzman cevabı", 800, -40, "4"),
      node("council", "## 🏛️ Council\n" + (ledger?.tasks ?? 0) + " görev · " + Object.entries(COUNCIL_SEATS).map(([o, w]) => o + " " + (w * 100).toFixed(0) + "%").join(" · "), 120, 380, "3", 620, 90),
    ],
    edges: [
      { id: "e0", fromNode: "q", toNode: "retr", label: "soru" },
      { id: "e1", fromNode: "retr", toNode: "ollamas", label: "context" },
      { id: "e2", fromNode: "retr", toNode: "ecym", label: "context" },
      { id: "e3", fromNode: "retr", toNode: "odysseus", label: "context" },
      { id: "e3b", fromNode: "retr", toNode: "claudecode", label: "context" },
      { id: "e4", fromNode: "ollamas", toNode: "gate", label: "uzman" },
      { id: "e5", fromNode: "ecym", toNode: "gate", label: "uzman" },
      { id: "e6", fromNode: "odysseus", toNode: "gate", label: "uzman" },
      { id: "e6b", fromNode: "claudecode", toNode: "gate", label: "uzman" },
      { id: "e7", fromNode: "gate", toNode: "final", label: "argmax w_j" },
      { id: "e8", fromNode: "council", toNode: "gate", label: "ödül→ağırlık" },
    ],
  };
  writeFileSync(join(vault, "orchestra.canvas"), JSON.stringify(canvas, null, 2));

  // runs.md — readable tail of the ask-shared orchestra runs (which expert won, weights).
  let runs: any[] = [];
  try {
    const raw = readFileSync(`${process.env.MISSION_CONTROL_DATA_DIR || `${process.env.HOME}/.llm-mission-control`}/ask-shared-runs.jsonl`, "utf8");
    runs = raw.trim().split("\n").filter(Boolean).slice(-30).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* no runs yet */ }
  const runRows = runs.map((r) => {
    const w = r.weights && typeof r.weights === "object" ? Object.entries(r.weights).map(([k, v]) => `${k} ${(Number(v) * 100).toFixed(0)}%`).join(" ") : "";
    return `| ${String(r.winner || "?")} | ${String(r.q || "").slice(0, 50).replace(/\|/g, "/")} | ${r.confidence != null ? Number(r.confidence).toFixed(2) : ""} | ${w} |`;
  }).join("\n");
  writeFileSync(join(dir, "runs.md"),
    `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra]\naliases: [ask-shared runs]\n---\n\n`
    + `# 🎯 Son ask-shared koşuları\n\n> [!info] Son ${runs.length} koşu · kazanan uzman + gate ağırlıkları\n\n`
    + `| Kazanan | Soru | Güven | Ağırlıklar |\n|---|---|---|---|\n${runRows || "| — | henüz koşu yok | | |"}\n\n[[Orchestra]]\n`);

  // status.md — sync-time snapshot of the 4-system orchestra health + L24 vault-usage proof.
  const usage = computeSystemUsage(vault);
  const now = Date.now();
  const ago = (ms: number | null): string => {
    if (ms == null) return "—";
    const d = now - ms;
    if (d < 0) return "şimdi";
    const m = Math.floor(d / 60000), h = Math.floor(m / 60), day = Math.floor(h / 24);
    return day > 0 ? `${day}g önce` : h > 0 ? `${h}s önce` : m > 0 ? `${m}dk önce` : "az önce";
  };
  const usageRows = [
    ["🔵 ollamas", "brain + gateway :3000", `${dump.memories.length} memory`, usage.ollamas],
    ["🟢 eCym", "komut uzmanı :11434", `${ecymCount} komut`, usage.ecym],
    ["🟣 odysseus", "research + Khoj :42110", usage.odysseus.online ? "Khoj online" : "Khoj offline", usage.odysseus],
    ["🔴 claudecode", "kod uzmanı (github-models)", "ask-shared cevap", usage.claudecode],
  ].map(([sys, rol, durum, u]: any) =>
    `| ${sys} | ${rol} | ${durum} | ${u.online ? "🟢" : "🔴"} ${u.detail} | ${ago(u.lastActivity)} |`).join("\n");
  // L47: append the live task panel — answer rate, per-member contribution, avg rounds, vetoes,
  // and what is waiting on a human. Derived from the outcome ledger + the board, best-effort so
  // a missing ledger never breaks the sync.
  let panelBlock = "";
  try {
    const ledgerFile = `${process.env.MISSION_CONTROL_DATA_DIR || `${process.env.HOME}/.llm-mission-control`}/orchestra-tasks.jsonl`;
    const outcomes = existsSync(ledgerFile) ? readOutcomes(readFileSync(ledgerFile, "utf8")) : [];
    const boardFile = join(dir, "sprint.md");
    const board = existsSync(boardFile) ? parseBoard(readFileSync(boardFile, "utf8")) : { frontmatter: "", lanes: { Backlog: [], Doing: [], Done: [] }, trailer: "" };
    panelBlock = "\n" + renderPanel(orchestraPanel(outcomes, board));
  } catch { /* panel is a bonus on top of the snapshot */ }

  writeFileSync(join(dir, "status.md"),
    `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra]\naliases: [orchestra status]\n---\n\n`
    + `# 🚦 Orkestra durumu\n\n> [!abstract] Sync anındaki anlık görüntü — her sistemin vault'u nasıl kullandığı\n\n`
    + `| Sistem | Rol | Durum | Vault kullanımı | Son aktivite |\n|---|---|---|---|---|\n${usageRows}\n\n`
    + `**Council:** seviye ${ledger?.level ?? "?"} · ${ledger?.tasks ?? 0} görev · [[council]]\n${panelBlock}\n[[Orchestra]]\n`);

  // L12: Kanban-plugin compatible sprint board — orchestra work lanes. Static scaffold the
  // human/agents fill; the Kanban plugin renders `## Lane` + `- [ ]` as draggable cards.
  const sprintPath = join(dir, "sprint.md");
  if (!existsSync(sprintPath)) writeFileSync(sprintPath,
    `---\nkanban-plugin: board\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, kanban]\n---\n\n`
    + `## 📥 Backlog\n\n- [ ] eCym misses → yeni komut onayı\n- [ ] odysseus Khoj online\n\n`
    + `## 🔨 Doing\n\n\n## ✅ Done\n\n- [x] claudecode 4. uzman\n- [x] orkestra federasyonu\n\n`
    + `%% kanban:settings\n\`\`\`\n{"kanban-plugin":"board","show-checkboxes":true}\n\`\`\`\n%%\n`);
}

// ── push: brain → vault (authoritative mirror, idempotent by content hash) ──
// pruneUntracked: when pull already ran this cycle (both-mode), every human note is
// already in the brain, so ANY note absent from the brain is a genuine orphan and safe
// to drop even without a manifest entry (covers pre-manifest legacy notes). push-only
// keeps the conservative manifest guard so an un-pulled human note is never deleted.
function pushBrainToVault(vault: string, dump: BrainDump, manifest: Manifest, neighbors: Map<string, string[]>, entityIdx: EntityIndex, pruneUntracked = false, opts: { obsidianUp?: boolean; obsidianTools?: number } = {}): SyncResult["push"] {
  let written = 0, skipped = 0;
  for (const m of dump.memories) {
    const mem: NoteMemory = { id: m.id, ns: m.ns, tier: m.tier, content: m.content, source: m.source, createdAt: m.createdAt, hits: m.hits, actor: m.actor, confidence: m.confidence, system: systemOf(m.source, m.actor) };
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
  const ecymCount = writeEcymNotes(vault);          // federate the eCym command catalog
  writeEcymLearningQueue(vault);                     // L10: eCym misses → learning queue
  writeOrchestra(vault, dump, ecymCount, opts.obsidianUp ?? false, opts.obsidianTools ?? 0); // hub + roles + council + canvas + sprint
  writeHome(vault, dump, entities, ecymCount);
  writeBase(vault);
  // The surfaces ollamas and eCym are actually browsed through. Until these existed the
  // vault had exactly one database view (brain.base, tier-scoped), so 221 eCym commands,
  // 305 entities and every journal rollup were invisible to Bases despite already carrying
  // the properties a view needs.
  writeEcymBase(vault);
  writeEcymHub(vault, ecymCount, ecymSplit(readEcymCommands()));
  writeEntitiesBase(vault);
  writeJournalBase(vault);
  // The FULL pin set, not just the new entries. bookmarks.json is otherwise seeded by a
  // write-once during config init, and this merge can land first — which would create the
  // file, make the write-once skip, and silently lose Home from the sidebar.
  mergeBookmarks(vault, [
    { type: "file", path: "Home.md", title: "🧠 Home" },
    { type: "file", path: "orchestra/Orchestra.md", title: "🎼 Orchestra" },
    { type: "file", path: "orchestra.canvas", title: "🎼 Orchestra map" },
    { type: "file", path: "entity-map.canvas", title: "🗺️ Entity map" },
    { type: "file", path: "_index/brain.base", title: "🗃️ Brain DB" },
    { type: "file", path: "ecym/eCym.md", title: "🟢 eCym" },
    { type: "file", path: "_index/ecym.base", title: "🗃️ eCym katalog" },
    { type: "file", path: "_index/entities.base", title: "🗺️ Varlıklar" },
    { type: "file", path: "_index/journal.base", title: "📅 Günlük" },
    { type: "file", path: "_index/ops.md", title: "🩺 Operasyon" },
  ]);
  // Operations surface + property types + a saved review layout. These read from the same
  // status the sync just produced, so they can never disagree with what was mirrored.
  writeOpsNote(vault, obsidianStatus({ vault }));
  mergeTypes(vault, {
    safe: "checkbox",
    degree: "number", hits: "number", confidence: "number",
    created: "datetime",
    level: "text", tier: "text", system: "text", id: "text", ns: "text", source: "text", name: "text",
  });
  writeBrainReviewWorkspace(vault);
  writeTierIndexes(vault, dump);
  writeTemplates(vault);
  writeJournal(vault, dump);                        // + L26 weekly/monthly rollups
  writeNamespaceIndex(vault, dump);
  writeRecallIndex(vault, dump, neighbors);         // L29: recall dashboard (live Dataview)
  writeEntityMapCanvas(vault, dump.facts);          // L18: visual knowledge map
  writeHubs(vault, dump, neighbors);                // L26: graph-centrality hub notes
  writeReviewQueue(vault, dump);                    // L26: spaced-review queue
  return { written, skipped, entities, pruned };
}

// ── pull: vault → brain (human edits/new notes upsert into the store) ──
async function pullVaultToBrain(
  vault: string, manifest: Manifest, brainIds: Set<string>,
  remember: NonNullable<SyncOpts["remember"]>,
  adopted?: AdoptedOriginal[],
): Promise<SyncResult["pull"]> {
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

  // L27 — human capture. inbox/ is the advertised drop zone; the vault ROOT is scanned too
  // because that is simply where Obsidian's "new note" button puts things, and four such
  // notes had been sitting unreachable by the brain.
  for (const rel of ["inbox", ""]) {
    const dir = rel ? join(vault, rel) : vault;
    if (!existsSync(dir)) continue;
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith(".md") || ROOT_RESERVED.has(fname)) continue;
      const src = join(dir, fname);
      if (!statSync(src).isFile()) continue;
      const text = readFileSync(src, "utf8");
      const mem = adoptHumanNote(fname, text, { createdAt: statSync(src).birthtimeMs || statSync(src).mtimeMs });
      // null = already a brain note (handled above), or an empty note nobody meant to write.
      if (!mem) { skipped++; continue; }
      await remember({
        id: mem.id, tier: mem.tier, content: mem.content,
        source: mem.source ?? "human/obsidian", ns: mem.ns, createdAt: mem.createdAt, hits: 0,
      });
      const h = contentHash(mem.content);
      manifest[mem.id] = { brainHash: h, vaultHash: h };
      adopted?.push({ path: src, id: mem.id, tier: mem.tier });
      ingested++;
    }
  }
  return { ingested, skipped, conflicts };
}

interface AdoptedOriginal { path: string; id: string; tier: string }

/**
 * L28 — sweep the empty shells Obsidian leaves behind. Clicking "new canvas"/"new base" and
 * changing your mind writes `Başlıksız.canvas`, `Başlıksız 1.base`, and so on; nine of them
 * had accumulated in the root. They are MOVED to _index/attic/, never deleted: emptiness is
 * inferred from bytes, and being wrong about that must stay recoverable.
 * Only untitled-shaped names are eligible, and only if they carry no content at all.
 */
const UNTITLED = /^(Başlıksız|Untitled|Sin título|Sans titre)( \d+)?\.(canvas|base)$/;

/**
 * Emptiness is STRUCTURAL, not byte-length. Obsidian does not write an empty file when you
 * create a canvas or base — it writes its default scaffold: a base gets `views: [table]`, a
 * canvas gets text nodes whose `text` is "". Comparing bytes left six of nine shells behind.
 * Any real signal — a filter, a formula, a data source, node text, a file reference, an edge —
 * means the user actually started something, and the file is left exactly where it is.
 */
export function isAbandonedShell(filename: string, body: string): boolean {
  const s = body.trim();
  if (!s || s === "{}" || s === "[]") return true;
  if (filename.endsWith(".canvas")) {
    try {
      const c = JSON.parse(s);
      if (Array.isArray(c?.edges) && c.edges.length) return false;
      const nodes = Array.isArray(c?.nodes) ? c.nodes : [];
      return nodes.every((n: any) => !String(n?.text ?? "").trim() && !n?.file && !n?.url);
    } catch { return false; } // unparseable → not ours to move
  }
  if (filename.endsWith(".base")) {
    // The default scaffold is view-only. A base the user shaped names a source or a rule.
    return !/^\s*(filters|formulas|properties|source|from)\s*:/m.test(s);
  }
  return false;
}

/**
 * entities.base — the 305 entity notes brain.base deliberately leaves out.
 *
 * brain.base is scoped to tier-tagged memories, which is correct: entities are a different
 * kind of thing. But that left the whole fact-graph with no tabular view, so the only way to
 * find the well-connected nodes was to open entity-map.canvas and squint. `degree` is already
 * on every entity note; this exposes it.
 */
export function writeEntitiesBase(vault: string): void {
  const base = `filters:\n  and:\n      - file.hasTag("entity")\n`
    + `formulas:\n  reach: 'if(note.degree > 8, "🌟 hub", if(note.degree > 2, "bağlı", "yaprak"))'\n`
    + `properties:\n`
    + `  note.degree:\n    displayName: Derece\n`
    + `  note.name:\n    displayName: Varlık\n`
    + `views:\n`
    + `  - type: table\n    name: Tümü\n    order:\n      - note.name\n      - note.degree\n      - formula.reach\n    limit: 400\n`
    + `  - type: table\n    name: 🌟 Hub'lar\n    filters:\n      and:\n        - note.degree > 8\n    order:\n      - note.name\n      - note.degree\n    limit: 50\n`
    + `  - type: table\n    name: Yapraklar\n    filters:\n      and:\n        - note.degree <= 2\n    order:\n      - note.name\n      - note.degree\n    limit: 200\n`
    + `  - type: cards\n    name: Kartlar\n    order:\n      - note.name\n      - note.degree\n`;
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "entities.base"), base);
}

/**
 * journal.base — daily notes, ISO-week rollups and month rollups are three different
 * questions ("what happened Tuesday", "what did last week amount to", "what is this month").
 * They already carry distinct tags; this gives each one its own view instead of one flat list.
 */
export function writeJournalBase(vault: string): void {
  const base = `filters:\n  and:\n      - file.hasTag("journal")\n`
    + `properties:\n`
    + `  file.name:\n    displayName: Dönem\n`
    + `views:\n`
    + `  - type: table\n    name: Günlük\n    filters:\n      and:\n        - '!file.hasTag("journal/weekly")'\n        - '!file.hasTag("journal/monthly")'\n    order:\n      - file.name\n    limit: 120\n`
    + `  - type: table\n    name: 🗓️ Haftalık\n    filters:\n      and:\n        - file.hasTag("journal/weekly")\n    order:\n      - file.name\n    limit: 60\n`
    + `  - type: table\n    name: 📆 Aylık\n    filters:\n      and:\n        - file.hasTag("journal/monthly")\n    order:\n      - file.name\n    limit: 36\n`;
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "journal.base"), base);
}

export interface BookmarkItem { type: string; path: string; title: string }

/**
 * Add generated surfaces to the vault's bookmarks WITHOUT touching what the operator put
 * there. The existing setup writes bookmarks.json only when it is absent (writeOnce), which
 * means new surfaces never appeared for anyone whose vault was already initialised — and a
 * plain overwrite would have deleted their own pins instead.
 *
 * Matching is by path: a bookmark the operator renamed keeps their title.
 */
export function mergeBookmarks(vault: string, add: BookmarkItem[]): void {
  const p = join(vault, ".obsidian", "bookmarks.json");
  let doc: any = { items: [] };
  if (existsSync(p)) {
    try {
      doc = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return; // unparseable — someone else's file, leave it exactly as it is
    }
  }
  if (!Array.isArray(doc?.items)) doc = { ...doc, items: [] };
  const have = new Set(doc.items.map((i: any) => String(i?.path ?? "")));
  let changed = false;
  for (const item of add) {
    if (have.has(item.path)) continue;
    doc.items.push(item);
    have.add(item.path);
    changed = true;
  }
  if (!changed && existsSync(p)) return;
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2));
}

/**
 * ops.md — the vault's own operations view. Until now the only way to see whether the mirror
 * was healthy was to leave Obsidian and run the CLI; this brings drift, conflicts and the
 * four systems' liveness into the graph itself, from obsidianStatus() so it can never
 * disagree with the source.
 *
 * It is deliberately HONEST about what it does not know: the e2e legs (odysseus reachability,
 * memory pressure) are not part of a sync, so instead of printing a fabricated green this
 * renders the command to run. A dashboard that invents a status is worse than no dashboard.
 */
export function renderOpsNote(status: ObsidianStatus): string {
  const su = status.systemUsage;
  const when = (ms: number | null): string => {
    if (!ms) return "—";
    const mins = Math.round((Date.now() - ms) / 60000);
    return mins < 1 ? "az önce" : mins < 60 ? `${mins} dk önce` : `${Math.round(mins / 60)} sa önce`;
  };
  const sysLine = (name: string, u: { online: boolean; lastActivity: number | null; detail: string }): string =>
    `> ${u.online ? "🟢" : "🔴"} **${name}** — ${u.online ? "online" : "offline"} · ${when(u.lastActivity)} · ${u.detail}`;

  const tierLines = Object.entries(status.notes)
    .map(([t, n]) => `- \`${t}\` — **${n}**`).join("\n");

  const driftLine = status.drift === 0
    ? "> [!success] Senkron — drift **0**"
    : `> [!warning] ⚠️ Drift **${status.drift}** — ${status.drift > 0 ? "aynalanmamış hafıza" : "fazla not"} var`;
  const conflictLine = status.conflicts === 0
    ? "> [!note] Çakışma yok"
    : `> [!danger] **${status.conflicts}** çakışma — \`_index/conflicts/\` bak`;

  return `---\ncssclasses: [brain]\ntags: [moc, ops]\naliases: [ops, operasyon]\n---\n\n`
    + `# 🩺 Operasyon\n\n`
    + `> [!abstract] Canlı ayna durumu\n`
    + `> **${status.brainMemories}** hafıza · **${status.entities}** varlık · son sync ${when(status.lastSync)}\n\n`
    + `${driftLine}\n\n${conflictLine}\n\n`
    + `## Katmanlar\n${tierLines}\n\n`
    + `## Sistemler\n`
    + `${sysLine("ollamas", su.ollamas)}\n`
    + `${sysLine("eCym", su.ecym)}\n`
    + `${sysLine("odysseus", su.odysseus)}\n`
    + `${sysLine("claudecode", su.claudecode)}\n\n`
    + `## E2E sağlık\n`
    + `> [!tip] Bu leg'ler sync'in bilgisi değil — ölçmek için çalıştır:\n`
    + `> \`cd ~/Desktop/ollamas && npx tsx scripts/e2e-gate.ts\`\n\n`
    + `[[Home]] · [[brain.base]] · [[eCym]]\n`;
}

export function writeOpsNote(vault: string, status: ObsidianStatus): void {
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "ops.md"), renderOpsNote(status));
}

/**
 * Register property types WITHOUT clobbering what is already there. The Tasks plugin owns 25
 * TQ_* entries in types.json; a plain overwrite would wipe them. Same rule as mergeBookmarks:
 * merge by key, a type the operator set by hand wins, an unparseable file is left alone.
 *
 * This is polish, not a fix — measured, brain.base's numeric filters already work because
 * Obsidian infers the type from the YAML value. Typing them makes the property panel show
 * `safe` as a checkbox and `degree` as a number, nothing more.
 */
export function mergeTypes(vault: string, add: Record<string, string>): void {
  const p = join(vault, ".obsidian", "types.json");
  let doc: any = { types: {} };
  if (existsSync(p)) {
    try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
  }
  if (!doc || typeof doc.types !== "object" || doc.types === null) doc = { ...doc, types: {} };
  let changed = false;
  for (const [k, v] of Object.entries(add)) {
    if (Object.prototype.hasOwnProperty.call(doc.types, k)) continue; // operator/plugin wins
    doc.types[k] = v;
    changed = true;
  }
  if (!changed && existsSync(p)) return;
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2));
}

// A leaf node in an Obsidian workspace layout. Shape verified against a workspace saved by
// the live app (obsidian workspace:save), not guessed: every leaf needs a state.type or the
// app silently drops the layout on load.
function wsLeaf(id: string, viewType: string, extra: Record<string, unknown> = {}): unknown {
  return { id, type: "leaf", state: { type: viewType, state: extra, title: viewType } };
}
function wsTabs(id: string, children: unknown[]): unknown {
  return { id, type: "tabs", children };
}
function wsSplit(id: string, direction: string, children: unknown[]): unknown {
  return { id, type: "split", children, direction };
}

/**
 * brain-review — a saved workspace: file-explorer + Home in the centre, the eCym catalog to
 * the side. The vault had none ("No workspaces saved."), so there was no one-key way back to
 * the review layout after wandering off into a note.
 *
 * The layout is intentionally minimal and every id is fixed, so the write is idempotent (a
 * second sync produces byte-identical JSON) and the merge never steals the operator's active
 * workspace. Ids are static strings — the schema needs them present, not unique-per-run.
 */
export function writeBrainReviewWorkspace(vault: string): void {
  const p = join(vault, ".obsidian", "workspaces.json");
  let doc: any = { workspaces: {}, active: "" };
  if (existsSync(p)) {
    try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
  }
  if (!doc || typeof doc.workspaces !== "object" || doc.workspaces === null) doc = { ...doc, workspaces: {} };

  doc.workspaces["brain-review"] = {
    main: wsSplit("br-main", "vertical", [
      wsTabs("br-main-tabs", [
        wsLeaf("br-home", "markdown", { file: "Home.md", mode: "preview" }),
        wsLeaf("br-ecym", "bases", { file: "_index/ecym.base" }),
      ]),
    ]),
    left: wsSplit("br-left", "horizontal", [
      wsTabs("br-left-tabs", [
        wsLeaf("br-fe", "file-explorer"),
        wsLeaf("br-search", "search"),
        wsLeaf("br-bm", "bookmarks"),
      ]),
    ]),
    right: wsSplit("br-right", "horizontal", [
      wsTabs("br-right-tabs", [
        wsLeaf("br-bl", "backlink"),
        wsLeaf("br-tag", "tag"),
      ]),
    ]),
    active: "br-home",
  };
  // Do not steal focus: only set active if the vault had no active workspace at all.
  if (!doc.active) doc.active = "brain-review";

  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2));
}

export function sweepEmptyShells(vault: string): { moved: string[] } {
  const moved: string[] = [];
  if (!existsSync(vault)) return { moved };
  const attic = join(vault, "_index", "attic");
  for (const f of readdirSync(vault)) {
    if (!UNTITLED.test(f)) continue;
    const src = join(vault, f);
    try {
      const st = statSync(src);
      if (!st.isFile()) continue;
      const body = readFileSync(src, "utf8");
      if (!isAbandonedShell(f, body)) continue;
      mkdirSync(attic, { recursive: true });
      writeFileSync(join(attic, f), body);
      rmSync(src);
      moved.push(f);
    } catch { /* skip anything we cannot read or move */ }
  }
  return { moved };
}

/**
 * Remove a hand-written original ONLY once the brain has materialised it as a proper tier
 * note. Ordering is the safety property: pull adopts → push writes <tier>/<id>.md → and only
 * then is the loose copy dropped. If the push failed, the original is left exactly where the
 * human put it, so a capture can never evaporate between the two steps.
 */
function reapAdoptedOriginals(vault: string, adopted: AdoptedOriginal[]): number {
  let reaped = 0;
  for (const a of adopted) {
    const materialised = join(vault, a.tier, noteFilename(a.id));
    if (!existsSync(materialised) || !existsSync(a.path)) continue;
    if (materialised === a.path) continue;
    rmSync(a.path);
    reaped++;
  }
  return reaped;
}

export interface AskResult {
  answer?: string; expert?: string; weights?: Record<string, number>; confidence?: number;
  expertAnswers?: Record<string, string>;
  /** L33/L34 transparency: what was measured, who sat out and why, and whether the
   *  measurement overruled the gate. Optional — an older caller simply renders less. */
  scores?: Record<string, number>;
  degradedReasons?: Record<string, string>;
  veto?: { from: string; to: string; delta: number; fromScore: number; toScore: number } | null;
}

const SYS_EMOJI: Record<string, string> = { ollamas: "🔵", ecym: "🟢", odysseus: "🟣", claudecode: "🔴" };

// L9: process the Obsidian-side ask queue. A human writes `- [ ] <question>` into
// orchestra/ask.md; each pending line is sent through askFn (ask-shared), the answer is
// written to orchestra/answers/<ts>.md, and the question is marked `- [x]` (idempotent —
// answered lines are skipped on the next run). Returns how many were answered.
export async function processAskQueue(vault: string, askFn: (q: string) => Promise<AskResult>): Promise<number> {
  const askPath = join(vault, "orchestra", "ask.md");
  if (!existsSync(askPath)) return 0;
  const lines = readFileSync(askPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const ansDir = join(vault, "orchestra", "answers");
  mkdirSync(ansDir, { recursive: true });
  let answered = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-\s*\[ \]\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const q = m[1].trim();
    if (!q || q.startsWith("<")) continue; // skip the template placeholder
    let r: AskResult; try { r = await askFn(q); } catch (e: any) { r = { answer: `⚠️ hata: ${e?.message || e}` }; }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = noteFilename(q.slice(0, 40)).replace(/\.md$/, "");
    const w = r.weights ? Object.entries(r.weights).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · ") : "";
    writeFileSync(join(ansDir, `${ts}-${slug}.md`),
      `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, answer]\naliases: [${JSON.stringify(q.slice(0, 60))}]\n---\n\n`
      + `# ❓ ${q}\n\n> [!success] Kazanan: **${r.expert || "?"}**${r.confidence != null ? ` · güven ${r.confidence.toFixed(2)}` : ""}\n> ${w}\n\n`
      // L34: when measured quality overruled the gate, say so plainly — a silent swap would
      // be just as opaque as the silent gate-always-wins it replaced.
      + (r.veto
          ? `> [!important] ⚡ Kalite vetosu — gate **${r.veto.from}** dedi, ölçüm **${r.veto.to}** dedi (Δ${r.veto.delta.toFixed(3)}: ${r.veto.fromScore.toFixed(3)} → ${r.veto.toScore.toFixed(3)}). Ölçüm kazandı.\n\n`
          : "")
      // L33: scores next to weights, and every absent seat named with its reason. The panel
      // used to report `degraded: []` while quoting a tool-error envelope as an opinion.
      + (r.scores && Object.keys(r.scores).length
          ? `> [!note]- Ölçülen kalite\n> ${Object.entries(r.scores).map(([e, s]) => `${e} ${Number(s).toFixed(3)}`).join(" · ")}\n\n`
          : "")
      + (r.degradedReasons && Object.keys(r.degradedReasons).length
          ? `> [!warning]- Katılmayan uzmanlar\n` + Object.entries(r.degradedReasons).map(([e, why]) => `> - **${e}** — ${why}`).join("\n") + "\n\n"
          : "")
      + `${r.answer || "_(cevap yok)_"}\n\n`
      + (r.expertAnswers && Object.keys(r.expertAnswers).length
          ? `## Uzman cevapları\n` + Object.entries(r.expertAnswers).map(([e, a]) =>
              `> [!quote]- ${SYS_EMOJI[e] || ""} ${e}\n> ${String(a).replace(/\n/g, "\n> ")}`).join("\n\n") + "\n\n"
          : "")
      + `[[Orchestra]] · [[runs]]\n`);
    lines[i] = lines[i].replace("- [ ]", "- [x]");
    answered++;
  }
  if (answered > 0) writeFileSync(askPath, lines.join("\n"));
  return answered;
}

export interface RecallHit { id: string; tier: string; score: number; excerpt: string }
export interface RecallQueueDeps {
  /** Semantic recall over the brain — authoritative, MRR 0.877. */
  recall: (q: string, k: number) => Promise<RecallHit[]>;
  /** Obsidian's own lexical search. Optional: absent/offline simply yields no lexical rows. */
  lexical?: (q: string, k: number) => Promise<{ path: string; score: number; context: string }[]>;
}

/**
 * L29 — ask the brain a question from inside Obsidian.
 *
 * The brain has semantic recall the vault cannot match, and the vault has an exact-string
 * index the embedding space blurs over. This is where the two are combined, and the reason
 * it happens HERE rather than inside askShared is honesty about scale: askShared's sources
 * feed p_ret, and a lexical score is not a cosine similarity. Mixing them there would
 * silently distort the weighting. In a note, the two lists simply sit side by side, each
 * labelled with where it came from, and the reader can see which channel found what.
 *
 * Same contract as processAskQueue: `- [ ] query` → answer note → `- [x]`, so re-running is
 * idempotent and a question is never answered twice.
 */
export async function processSearchQueue(vault: string, deps: RecallQueueDeps): Promise<number> {
  const qPath = join(vault, "orchestra", "search.md");
  if (!existsSync(qPath)) return 0;
  const lines = readFileSync(qPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const ansDir = join(vault, "orchestra", "answers");
  mkdirSync(ansDir, { recursive: true });
  let answered = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-\s*\[ \]\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const q = m[1].trim();
    if (!q || q.startsWith("<")) continue; // template placeholder

    let sem: RecallHit[] = [];
    let lex: { path: string; score: number; context: string }[] = [];
    let err = "";
    try { sem = await deps.recall(q, 8); } catch (e: any) { err = `recall: ${e?.message || e}`; }
    // Lexical is strictly a bonus channel — a closed Obsidian must not fail the query.
    if (deps.lexical) { try { lex = await deps.lexical(q, 8); } catch { /* vault offline */ } }

    const semBlock = sem.length
      ? sem.map((h) => `- **[[${memBase(h.id)}|${h.id}]]** · ${h.tier} · ${h.score.toFixed(3)}\n  > ${h.excerpt.replace(/\s+/g, " ").slice(0, 220)}`).join("\n")
      : "_(anlamsal isabet yok)_";
    const lexBlock = lex.length
      ? lex.map((h) => `- [[${h.path.replace(/\.md$/, "")}]] · ${h.score.toFixed(3)}\n  > ${h.context.slice(0, 220)}`).join("\n")
      : "_(sözcüksel isabet yok — Obsidian kapalı olabilir)_";

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = noteFilename(q.slice(0, 40)).replace(/\.md$/, "");
    writeFileSync(join(ansDir, `search-${ts}-${slug}.md`),
      `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, search]\naliases: [${JSON.stringify(q.slice(0, 60))}]\n---\n\n`
      + `# 🔎 ${q}\n\n`
      + (err ? `> [!warning] ${err}\n\n` : `> [!info] ${sem.length} anlamsal · ${lex.length} sözcüksel isabet\n\n`)
      + `## 🧠 Anlamsal (brain)\n${semBlock}\n\n`
      + `## 🔤 Sözcüksel (Obsidian)\n${lexBlock}\n\n`
      + `[[Orchestra]] · [[recall]]\n`);
    lines[i] = lines[i].replace("- [ ]", "- [x]");
    answered++;
  }
  if (answered > 0) writeFileSync(qPath, lines.join("\n"));
  return answered;
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
  const adopted: AdoptedOriginal[] = [];
  let audio: AudioSyncResult | undefined;

  // L28: transcribe BEFORE pull. A voice memo becomes an inbox note, and the very same pull
  // that follows adopts it — one capture path, no second ingestion route.
  if (direction === "pull" || direction === "both") {
    try { audio = await syncAudio(vault); } catch { /* STT is best-effort; never fail a sync tick */ }
    try { sweepEmptyShells(vault); } catch { /* cosmetic */ }
  }

  // pull FIRST (ingest human edits) so the subsequent mirror can't clobber them.
  if (direction === "pull" || direction === "both") {
    const dump0 = exportBrain(dbPath);
    const brainIds = new Set(dump0.memories.map((m) => m.id));
    pull = await pullVaultToBrain(vault, manifest, brainIds, remember, adopted);
    try { readApprovedLearning(vault); } catch { /* L16 handoff best-effort */ } // vault → eCym learn queue
    // L23: close the loop — feed fresh vault approvals into misses.log so ecy-learn drafts them.
    // Only queues misses (never edits the dataset); the actual drafting runs out-of-band.
    try { bridgeApprovedToMisses(); } catch { /* best-effort */ }
  }
  if (direction === "push" || direction === "both") {
    const dump = exportBrain(dbPath); // re-read: reflects anything pull just ingested
    // Density sources: memory→memory nearest neighbors (stored-vector KNN, no re-embed) +
    // memory→entity mentions. Injectable for tests; defaults to the live brain.
    const neighbors = opts.neighbors ? opts.neighbors() : neighborsFromDb(dbPath, 5);
    const entityIdx = buildEntityIndex(dump.facts);
    // L36: probe the live vault so the hub can show obsidian's REAL membership state rather
    // than a hardcoded badge. A closed app renders as offline, never as silently absent.
    let obsidianUp = false, obsidianTools = 0;
    try {
      const { obsidianHealth } = await import("./obsidian-rest");
      const h = await obsidianHealth();
      obsidianUp = h.ok; obsidianTools = h.ok ? 16 : 0;
    } catch { /* best-effort */ }
    push = pushBrainToVault(vault, dump, manifest, neighbors, entityIdx, direction === "both", { obsidianUp, obsidianTools });
    await writeOdysseusNotes(vault); // L11: Khoj federation (graceful — offline → placeholder)
    writeObsidianConfig(vault); // create-once: graph color-groups, plugins, appearance
    // Safe only here: the tier note now exists on disk, so dropping the loose copy the human
    // typed cannot lose the capture. Never runs on a pull-only sync (nothing was mirrored).
    if (adopted.length) push.adopted = reapAdoptedOriginals(vault, adopted);
  }

  saveManifest(vault, manifest);
  const memories = exportBrain(dbPath).memories.length;
  return { direction, push, pull, vault, memories, ...(audio ? { audio } : {}) };
}

export interface SystemUsage {
  lastActivity: number | null; // epoch ms of the most recent vault read/write by this system
  online: boolean;             // is the system currently participating
  detail: string;              // how this system uses the vault
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
  systemUsage: Record<"ollamas" | "ecym" | "odysseus" | "claudecode", SystemUsage>; // L24
}

const mtimeOr = (p: string): number | null => { try { return statSync(p).mtimeMs; } catch { return null; } };

// L24: prove each of the 4 systems actively uses the vault, derived from real artifacts (no
// self-report). ollamas: the sync manifest it read+writes. eCym: the approval/learn queue files
// it feeds. odysseus: its Khoj federation note (+ its `✅ online` marker). claudecode: the
// ask-shared run ledger it answers into.
export function computeSystemUsage(vault: string): ObsidianStatus["systemUsage"] {
  const home = process.env.HOME;
  const dataDir = process.env.MISSION_CONTROL_DATA_DIR || `${home}/.llm-mission-control`;
  const khojNote = join(vault, "odysseus", "_khoj.md");
  let khojOnline = false;
  try { khojOnline = /✅\s*online/.test(readFileSync(khojNote, "utf8")); } catch { /* no note yet */ }
  const approved = mtimeOr(`${home}/ecy-model/approved-learning.jsonl`);
  const misses = mtimeOr(`${home}/ecy-model/misses.log`);
  const ecymAct = [approved, misses].filter((n): n is number => n != null).sort((a, b) => b - a)[0] ?? null;
  // L27: claudecode liveness from evidence, not a static flag — did it actually answer in any of
  // the recent ask-shared runs? A throttled/degraded claudecode (github-models quota) then shows
  // offline honestly instead of a permanent green.
  const runsPath = `${dataDir}/ask-shared-runs.jsonl`;
  let ccOnline = false;
  try {
    const recent = readFileSync(runsPath, "utf8").trim().split("\n").filter(Boolean).slice(-10);
    ccOnline = recent.some((l) => { try { return (JSON.parse(l).experts || []).includes("claudecode"); } catch { return false; } });
  } catch { /* no runs yet → offline */ }
  return {
    ollamas: { lastActivity: mtimeOr(manifestPath(vault)), online: true, detail: "brain⇄vault çift-yönlü sync (read+write)" },
    ecym: { lastActivity: ecymAct, online: existsSync(ecymDatasetPath()), detail: "katalog mirror + onay + ecy-learn kuyruğu" },
    odysseus: { lastActivity: mtimeOr(khojNote), online: khojOnline, detail: khojOnline ? "Khoj federe (online)" : "Khoj federasyon (offline placeholder)" },
    claudecode: { lastActivity: mtimeOr(runsPath), online: ccOnline, detail: ccOnline ? "ask-shared cevap veriyor" : "ask-shared (son 10 run'da cevap yok — throttle?)" },
  };
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
  return { vault, exists: existsSync(vault), notes, entities, brainMemories, drift: brainMemories - total, conflicts, lastSync, systemUsage: computeSystemUsage(vault) };
}
