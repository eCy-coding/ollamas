// O0 demo module store — the ONLY place demo touches persistence, and it does so
// exclusively through the _core/store facade (never server/store directly; the
// eslint import-guard enforces this). SQLite table = module_demo_items (v7, core
// ledger); vector collection = "demo" (per-collection sqlite-vec file, K2).
import crypto from "node:crypto";
import { getModuleDb, getVectorCollection, type Embedder, type VectorStore } from "../_core/store";
import type { DemoItem } from "./schema";

// Test seam (KN — deterministic search without ollama): inject a fake embedder.
// Production leaves this unset → the collection uses the resolved ollama/cloud embedder.
let _embed: Embedder | undefined;
let _vec: VectorStore | null = null;

export function _setDemoEmbedder(fn?: Embedder): void {
  _embed = fn;
  _vec = null; // re-open on next use so the new embedder (and env baseDir) apply
}

function vec(): VectorStore {
  if (!_vec) _vec = getVectorCollection("demo", _embed ? { embed: _embed } : {});
  return _vec;
}

export async function addItem(text: string): Promise<DemoItem> {
  const db = await getModuleDb();
  const item: DemoItem = { id: crypto.randomUUID(), text, created_at: new Date().toISOString() };
  await db.run("INSERT INTO module_demo_items (id, text, created_at) VALUES (?,?,?)", [
    item.id,
    item.text,
    item.created_at,
  ]);
  await vec().upsert(item.id, item.text); // index for semantic search
  return item;
}

export async function listItems(): Promise<DemoItem[]> {
  const db = await getModuleDb();
  const { rows } = await db.query("SELECT id, text, created_at FROM module_demo_items ORDER BY created_at");
  return rows as DemoItem[];
}

export async function searchItems(q: string, k = 3): Promise<{ id: string; text: string; distance: number }[]> {
  return vec().query(q, k);
}
