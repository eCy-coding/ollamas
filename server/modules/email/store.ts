// O4 email module store — the ONLY place this module touches persistence,
// exclusively through the _core/store facade (never server/store directly;
// the eslint import-guard enforces this, server/store/__tests__/
// module-migrations.test.ts). Claims migration v11 off the GLOBAL ledger in
// ../registry.ts — v11 was reserved in the ledger comment for a not-yet-built
// O8 security migration (tenants.role + totp_secrets); grep confirms no such
// migration exists in code, so v11 is free and O4 email claims it here (O8
// claims the next free slot off the v14+ pool when it lands).
//
// Cache-only, not source-of-truth (IMAP is): a resync (syncMessages) upserts
// by id = `${folder}:${uid}` and refreshes subject/body/date, but deliberately
// leaves `triage` untouched on conflict so a manual override (setTriage)
// survives the next sync.
import type { Migration } from "../../store/migrations";
import { getModuleDb } from "../_core/store";
import type { MessageRecord, RawEmailMessage, TriageLabel } from "./schema";

const MESSAGES_TABLE = "module_email_messages";

export const MIGRATION_V11_EMAIL: Migration = {
  version: 11,
  name: "email_messages_cache",
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${MESSAGES_TABLE} (
      id TEXT PRIMARY KEY,
      folder TEXT NOT NULL,
      from_addr TEXT NOT NULL DEFAULT '',
      to_addr TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      snippet TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      body_html TEXT,
      triage TEXT NOT NULL DEFAULT 'archive',
      created_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_email_messages_folder ON ${MESSAGES_TABLE}(folder, date DESC)`);
  },
  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_email_messages_folder`);
    await db.exec(`DROP TABLE IF EXISTS ${MESSAGES_TABLE}`);
  },
};

function rowToMessage(r: Record<string, unknown>): MessageRecord {
  return {
    id: String(r.id),
    folder: String(r.folder),
    from: String(r.from_addr ?? ""),
    to: String(r.to_addr ?? ""),
    subject: String(r.subject ?? ""),
    date: String(r.date),
    snippet: String(r.snippet ?? ""),
    bodyText: String(r.body_text ?? ""),
    bodyHtml: r.body_html === null || r.body_html === undefined ? null : String(r.body_html),
    triage: r.triage as TriageLabel,
    createdAt: String(r.created_at),
  };
}

const snippetOf = (text: string): string => text.trim().slice(0, 140);

/** Upsert a batch of raw IMAP messages for `folder`, classifying each with
 *  `classify` (only applied on first insert — see header comment). Returns the
 *  full persisted set for the folder, most-recent first. */
export async function upsertMessages(
  folder: string,
  raw: RawEmailMessage[],
  classify: (msg: { subject: string; text: string }) => TriageLabel,
): Promise<MessageRecord[]> {
  const db = await getModuleDb();
  const now = new Date().toISOString();
  for (const m of raw) {
    const id = `${folder}:${m.uid}`;
    const triage = classify({ subject: m.subject, text: m.text });
    await db.run(
      `INSERT INTO ${MESSAGES_TABLE}
         (id, folder, from_addr, to_addr, subject, date, snippet, body_text, body_html, triage, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         subject = excluded.subject,
         date = excluded.date,
         snippet = excluded.snippet,
         body_text = excluded.body_text,
         body_html = excluded.body_html`,
      [id, folder, m.from, m.to, m.subject, m.date, snippetOf(m.text), m.text, m.html ?? null, triage, now],
    );
  }
  return selectMessages(folder);
}

export async function selectMessages(folder: string): Promise<MessageRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, folder, from_addr, to_addr, subject, date, snippet, body_text, body_html, triage, created_at
       FROM ${MESSAGES_TABLE} WHERE folder = ? ORDER BY date DESC`,
    [folder],
  );
  return rows.map(rowToMessage);
}

export async function selectMessage(id: string): Promise<MessageRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, folder, from_addr, to_addr, subject, date, snippet, body_text, body_html, triage, created_at
       FROM ${MESSAGES_TABLE} WHERE id = ?`,
    [id],
  );
  return rows[0] ? rowToMessage(rows[0]) : undefined;
}

export async function updateTriage(id: string, label: TriageLabel): Promise<MessageRecord | undefined> {
  const existing = await selectMessage(id);
  if (!existing) return undefined;
  const db = await getModuleDb();
  await db.run(`UPDATE ${MESSAGES_TABLE} SET triage = ? WHERE id = ?`, [label, id]);
  return { ...existing, triage: label };
}
