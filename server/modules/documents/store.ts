// O3 documents module store — the ONLY place this module touches persistence,
// exclusively through the _core/store facade (never server/store directly; the
// eslint import-guard enforces this, server/store/__tests__/module-migrations.test.ts).
// Claims v13 off the GLOBAL ledger in server/modules/registry.ts (v12 = O2
// research runs, the last claimed slot at the time this module was added; v13+
// remains free pool for the next module).
import crypto from "node:crypto";
import type { Migration } from "../../store/migrations";
import { getModuleDb } from "../_core/store";
import type { DocKind, DocumentRecord, SheetData } from "./schema";

const DOCUMENTS_TABLE = "module_documents";

export const MIGRATION_V13_DOCUMENTS: Migration = {
  version: 13,
  name: "o3_documents",
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${DOCUMENTS_TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      html TEXT,
      pages INTEGER,
      sheets TEXT,
      truncated INTEGER NOT NULL DEFAULT 0,
      extract_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_kind ON ${DOCUMENTS_TABLE}(kind)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_created_at ON ${DOCUMENTS_TABLE}(created_at)`);
  },
  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_documents_created_at`);
    await db.exec(`DROP INDEX IF EXISTS idx_documents_kind`);
    await db.exec(`DROP TABLE IF EXISTS ${DOCUMENTS_TABLE}`);
  },
};

function rowToDocument(r: Record<string, unknown>): DocumentRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as DocKind,
    mime: String(r.mime),
    bytes: Number(r.bytes),
    text: String(r.text ?? ""),
    html: r.html === null || r.html === undefined ? undefined : String(r.html),
    pages: r.pages === null || r.pages === undefined ? undefined : Number(r.pages),
    sheets: r.sheets ? (JSON.parse(String(r.sheets)) as SheetData[]) : undefined,
    truncated: Number(r.truncated) === 1,
    extractError: r.extract_error === null || r.extract_error === undefined ? undefined : String(r.extract_error),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function insertDocument(input: {
  name: string;
  kind: DocKind;
  mime: string;
  bytes: number;
  text: string;
  html?: string;
  pages?: number;
  sheets?: SheetData[];
  truncated: boolean;
  extractError?: string;
}): Promise<DocumentRecord> {
  const db = await getModuleDb();
  const now = new Date().toISOString();
  const doc: DocumentRecord = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...input };
  await db.run(
    `INSERT INTO ${DOCUMENTS_TABLE}
      (id, name, kind, mime, bytes, text, html, pages, sheets, truncated, extract_error, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      doc.id,
      doc.name,
      doc.kind,
      doc.mime,
      doc.bytes,
      doc.text,
      doc.html ?? null,
      doc.pages ?? null,
      doc.sheets ? JSON.stringify(doc.sheets) : null,
      doc.truncated ? 1 : 0,
      doc.extractError ?? null,
      doc.created_at,
      doc.updated_at,
    ],
  );
  return doc;
}

export async function selectDocuments(): Promise<DocumentRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, name, kind, mime, bytes, text, html, pages, sheets, truncated, extract_error, created_at, updated_at
     FROM ${DOCUMENTS_TABLE} ORDER BY created_at DESC`,
  );
  return rows.map(rowToDocument);
}

export async function selectDocument(id: string): Promise<DocumentRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, name, kind, mime, bytes, text, html, pages, sheets, truncated, extract_error, created_at, updated_at
     FROM ${DOCUMENTS_TABLE} WHERE id = ?`,
    [id],
  );
  return rows[0] ? rowToDocument(rows[0]) : undefined;
}

export async function removeDocument(id: string): Promise<boolean> {
  const db = await getModuleDb();
  const existing = await selectDocument(id);
  if (!existing) return false;
  await db.run(`DELETE FROM ${DOCUMENTS_TABLE} WHERE id = ?`, [id]);
  return true;
}
