// Maintain-time brain bridges (S29/S36/S41/S38 + S48 governor) — the DURABLE-source
// half of the integration layer. The decisive rule (docs/BRAIN-SERVICES.md): a
// source that persists on its own (jsonl log, fetched KEV catalog, rag.db, the
// on-disk hierarchy policy) is read in the nightly sleep-time pass — no server,
// no events, no data loss. Ephemeral sources (tool callbacks, verdict
// transitions, error ring) go through the S26 bus instead.
//
// Contracts shared by every bridge:
//   • writes ONLY via the injected store surface (brainRemember/brainAssertFact
//     semantics → S24 redaction + AUDN + ns-jail all apply)
//   • ns "ops" — infra memories never pollute the chat ("default") or org ns
//   • deterministicId(source, key) — re-runs upsert, never duplicate
//   • budgetAllow(source) — a noisy source rots only its own daily slice
//   • per-bridge try/catch: one broken source never blocks the others
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { budgetAllow, deterministicId } from "./brain-bus";
import type { BrainMemoryInput, BrainFactInput } from "./brain";

export const OPS_NS = "ops";

export interface BridgeWriter {
  remember(m: BrainMemoryInput): Promise<unknown>;
  assertFact(f: BrainFactInput): Promise<unknown>;
}

export interface BridgeCursor {
  seyirOffset?: number;
  kevSeen?: string[];
  ragSeen?: string[];
  hierarchyHash?: string;
}

export interface BridgeReport {
  seyir: number;
  kev: number;
  rag: number;
  hierarchy: number;
  errors: string[];
}

const cursorPath = () =>
  process.env.BRAIN_BRIDGE_CURSOR ||
  path.join(process.env.HOME || "", ".llm-mission-control", "brain-bridges-cursor.json");

export function readCursor(p = cursorPath()): BridgeCursor {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as BridgeCursor;
  } catch {
    return {};
  }
}

export function writeCursor(c: BridgeCursor, p = cursorPath()): void {
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(c));
  } catch { /* cursor is best-effort — worst case a re-run upserts idempotently */ }
}

// ── S29: seyir-defteri → episodic ────────────────────────────────────────────
/** Pure: fold new jsonl bytes into episodic memory inputs. Offset-cursored so
 *  each nightly pass reads only the tail; budget-capped upstream. */
export function foldSeyirLines(chunk: string, offsetBase: number): { items: { key: string; content: string; at: number }[] } {
  const items: { key: string; content: string; at: number }[] = [];
  let pos = 0;
  for (const line of chunk.split("\n")) {
    const t = line.trim();
    pos += line.length + 1;
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t) as { ts?: string; kind?: string; entry?: Record<string, unknown> };
      const at = j.ts ? Date.parse(j.ts) : NaN;
      // web-vital telemetry is high-volume noise, not memory; keep operational kinds.
      if (j.kind === "note" && (j.entry as { metric?: string } | undefined)?.metric) continue;
      const summary = `seyir ${j.kind ?? "entry"}: ${JSON.stringify(j.entry ?? {}).slice(0, 240)}`;
      items.push({ key: `${offsetBase + pos}`, content: summary, at: Number.isFinite(at) ? at : Date.now() });
    } catch { /* skip bad line */ }
  }
  return { items };
}

async function bridgeSeyir(w: BridgeWriter, cursor: BridgeCursor): Promise<number> {
  const p = path.join(process.env.HOME || "", ".llm-mission-control", "seyir-defteri.jsonl");
  if (!existsSync(p)) return 0;
  const size = statSync(p).size;
  const from = Math.min(cursor.seyirOffset ?? 0, size);
  if (size <= from) { cursor.seyirOffset = size; return 0; }
  const chunk = readFileSync(p, "utf8").slice(from);
  const { items } = foldSeyirLines(chunk, from);
  let wrote = 0;
  for (const it of items) {
    if (!budgetAllow("seyir")) break;
    await w.remember({
      id: deterministicId("seyir", it.key),
      tier: "episodic", content: it.content, source: "seyir-defteri", ns: OPS_NS, createdAt: it.at,
    });
    wrote++;
  }
  cursor.seyirOffset = size;
  return wrote;
}

// ── S36: KEV catalog → facts (delta-only) ────────────────────────────────────
export interface KevItem { id: string; title: string; }

/** Pure: which fetched KEV items are NEW relative to the seen-set. */
export function newKevItems(items: KevItem[], seen: Set<string>): KevItem[] {
  return items.filter((i) => i.id && !seen.has(i.id));
}

async function bridgeKev(w: BridgeWriter, cursor: BridgeCursor): Promise<number> {
  if (process.env.BRAIN_KEV_INGEST === "0") return 0;
  const { FEEDS, fetchFeed } = await import("./threatfeed");
  const kev = FEEDS.find((f) => f.id === "cisa-kev" || /kev/i.test(f.id));
  if (!kev) return 0;
  // FeedItem has no id field — the KEV entry's stable identity is its link (CVE URL),
  // falling back to title for malformed rows.
  const items = ((await fetchFeed(kev)) ?? []).map((i) => ({ id: i.link || i.title, title: i.title }));
  const seen = new Set(cursor.kevSeen ?? []);
  let wrote = 0;
  for (const it of newKevItems(items, seen)) {
    if (!budgetAllow("kev")) break;
    await w.assertFact({
      subject: it.id.slice(0, 120), predicate: "kev_listed", object: it.title.slice(0, 200),
      episodeId: deterministicId("kev", it.id), ns: OPS_NS,
    });
    seen.add(it.id);
    wrote++;
  }
  // Seen-set bounded: keep the newest ~2000 ids (catalog is ~1300 and append-only).
  cursor.kevSeen = [...seen].slice(-2000);
  return wrote;
}

// ── S41: rag documents → facts ───────────────────────────────────────────────
async function bridgeRag(w: BridgeWriter, cursor: BridgeCursor): Promise<number> {
  const p = process.env.RAG_DB_PATH || path.join(process.env.HOME || "", ".llm-mission-control", "rag.db");
  if (!existsSync(p)) return 0;
  const db = new DatabaseSync(p, { readOnly: true });
  let rows: { doc_id: string; text: string }[];
  try {
    rows = db.prepare("SELECT doc_id, text FROM rag_docs").all() as { doc_id: string; text: string }[];
  } catch {
    return 0; // rag store predates rag_docs — nothing to bridge
  } finally {
    db.close();
  }
  const seen = new Set(cursor.ragSeen ?? []);
  let wrote = 0;
  for (const r of rows) {
    if (seen.has(r.doc_id)) continue;
    if (!budgetAllow("rag")) break;
    await w.assertFact({
      subject: `doc:${r.doc_id}`.slice(0, 120), predicate: "ingested_topic",
      object: r.text.slice(0, 160).replace(/\s+/g, " "),
      episodeId: deterministicId("rag", r.doc_id), ns: OPS_NS,
    });
    seen.add(r.doc_id);
    wrote++;
  }
  cursor.ragSeen = [...seen].slice(-5000);
  return wrote;
}

// ── S38: hierarchy policy snapshot → procedural memory ───────────────────────
async function bridgeHierarchy(w: BridgeWriter, cursor: BridgeCursor): Promise<number> {
  const p = process.env.HIERARCHY_POLICY_PATH || path.join(process.cwd(), "orchestration", "HIERARCHY_POLICY.json");
  if (!existsSync(p)) return 0;
  const raw = readFileSync(p, "utf8");
  const hash = deterministicId("hierarchy", raw);
  if (cursor.hierarchyHash === hash) return 0; // unchanged policy → nothing new to learn
  if (!budgetAllow("hierarchy")) return 0;
  await w.remember({
    id: deterministicId("hierarchy", "current-policy"),
    tier: "procedural",
    content: `hierarchy policy snapshot: ${raw.slice(0, 400)}`,
    source: "hierarchy-policy", ns: OPS_NS,
  });
  cursor.hierarchyHash = hash;
  return 1;
}

// ── S48: memory-pressure governor (report-only) ──────────────────────────────
export interface PressureReport {
  dbBytes: number;
  memories: number;
  suggestions: string[];
}

/** Pure: turn store stats into tuning suggestions — NEVER acts on them (SSGM). */
export function assessPressure(stats: {
  memories: Record<string, number>;
  dbBytes: number;
  embedCacheRows: number;
}, env: { BRAIN_DB_BUDGET_MB?: string } = process.env): PressureReport {
  const total = Object.values(stats.memories).reduce((a, b) => a + b, 0);
  const budgetMb = Number(env.BRAIN_DB_BUDGET_MB) || 256;
  const suggestions: string[] = [];
  if (stats.dbBytes > budgetMb * 1024 * 1024) {
    suggestions.push(`db ${(stats.dbBytes / 1048576).toFixed(0)}MB over budget ${budgetMb}MB — consider lowering BRAIN_PRUNE_THRESHOLD or BRAIN_FACT_PRUNE_DAYS`);
  }
  const epi = stats.memories.episodic ?? 0;
  if (total > 0 && epi / total > 0.85) {
    suggestions.push(`episodic ${epi}/${total} dominates — consolidation may be starved (check access patterns)`);
  }
  if (stats.embedCacheRows > 4500) {
    suggestions.push(`embed_cache ${stats.embedCacheRows} near cap 5000 — raise BRAIN_EMBED_CACHE_CAP or accept churn`);
  }
  return { dbBytes: stats.dbBytes, memories: total, suggestions };
}

// ── orchestrator ─────────────────────────────────────────────────────────────
/** Run every durable-source bridge; one failure never blocks the rest. Called
 *  from brain-maintain BEFORE consolidate (fresh episodics can promote later). */
export async function runMaintainBridges(w: BridgeWriter, cursorFile = cursorPath()): Promise<BridgeReport> {
  const cursor = readCursor(cursorFile);
  const report: BridgeReport = { seyir: 0, kev: 0, rag: 0, hierarchy: 0, errors: [] };
  const run = async (name: keyof Omit<BridgeReport, "errors">, fn: () => Promise<number>) => {
    try {
      report[name] = await fn();
    } catch (e) {
      report.errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  await run("seyir", () => bridgeSeyir(w, cursor));
  await run("kev", () => bridgeKev(w, cursor));
  await run("rag", () => bridgeRag(w, cursor));
  await run("hierarchy", () => bridgeHierarchy(w, cursor));
  writeCursor(cursor, cursorFile);
  return report;
}
