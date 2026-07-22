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
import { writeEcymNotes, writeEcymLearningQueue, readApprovedLearning } from "./brain-obsidian-ecym";
import { writeOdysseusNotes } from "./brain-obsidian-khoj";
import { toMarkdown, parseMarkdown, noteFilename, contentHash, TIERS, type NoteMemory } from "./brain-obsidian-note";

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
    + `> [[Orchestra]] — 3-sistem hub + Canvas · [[council]] — ödül defteri · 🟢 eCym ${ecymCount} komut\n\n`
    + `## Katmanlar\n`
    + TIERS.map((t) => `- ${TIER_EMOJI[t]} [[tier-${t}|${t}]] — **${count(t)}** · _${TIER_DESC[t]}_`).join("\n")
    + `\n- 🟠 [[entities|entities]] — **${entities}**\n\n`
    + `## 🗃️ Veritabanı görünümü\n![[brain.base]]\n\n`
    + `## 🗺️ Görsel haritalar\n[[orchestra.canvas|Orkestra akışı]] · [[entity-map.canvas|Bilgi haritası]]\n\n`
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
  return days.length;
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
function writeOrchestra(vault: string, dump: BrainDump, ecymCount: number): void {
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

  // status.md — sync-time snapshot of the 4-system orchestra health.
  writeFileSync(join(dir, "status.md"),
    `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra]\naliases: [orchestra status]\n---\n\n`
    + `# 🚦 Orkestra durumu\n\n> [!abstract] Sync anındaki anlık görüntü\n\n`
    + `| Sistem | Rol | Durum |\n|---|---|---|\n`
    + `| 🔵 ollamas | brain + gateway :3000 | ${dump.memories.length} memory |\n`
    + `| 🟢 eCym | komut uzmanı :11434 | ${ecymCount} komut |\n`
    + `| 🟣 odysseus | research :7860 | harici Khoj |\n`
    + `| 🔴 claudecode | kod uzmanı | github-models (keyless) |\n\n`
    + `**Council:** seviye ${ledger?.level ?? "?"} · ${ledger?.tasks ?? 0} görev · [[council]]\n\n[[Orchestra]]\n`);

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
function pushBrainToVault(vault: string, dump: BrainDump, manifest: Manifest, neighbors: Map<string, string[]>, entityIdx: EntityIndex, pruneUntracked = false): SyncResult["push"] {
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
  writeOrchestra(vault, dump, ecymCount);           // council mirror + hub + canvas + sprint
  writeHome(vault, dump, entities, ecymCount);
  writeBase(vault);
  writeTierIndexes(vault, dump);
  writeTemplates(vault);
  writeJournal(vault, dump);
  writeNamespaceIndex(vault, dump);
  writeEntityMapCanvas(vault, dump.facts);          // L18: visual knowledge map
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

export interface AskResult { answer?: string; expert?: string; weights?: Record<string, number>; confidence?: number; expertAnswers?: Record<string, string> }

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
    try { readApprovedLearning(vault); } catch { /* L16 handoff best-effort */ } // vault → eCym learn queue
  }
  if (direction === "push" || direction === "both") {
    const dump = exportBrain(dbPath); // re-read: reflects anything pull just ingested
    // Density sources: memory→memory nearest neighbors (stored-vector KNN, no re-embed) +
    // memory→entity mentions. Injectable for tests; defaults to the live brain.
    const neighbors = opts.neighbors ? opts.neighbors() : neighborsFromDb(dbPath, 5);
    const entityIdx = buildEntityIndex(dump.facts);
    push = pushBrainToVault(vault, dump, manifest, neighbors, entityIdx, direction === "both");
    await writeOdysseusNotes(vault); // L11: Khoj federation (graceful — offline → placeholder)
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
