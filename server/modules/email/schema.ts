// O4 email module — wire types + input validation (honest 400 before any
// work). Mirrors server/modules/notes-tasks/schema.ts / cookbook/schema.ts.
// Types are shared with the frontend EmailPanel via the /api/modules/email/*
// JSON payloads.

/** Triage buckets shown as component-scoped colored TEXT badges in the panel
 *  (action=amber, waiting=info, archive=muted — PIPELINE-LESSONS #9: text, not
 *  color-only). Single enum source (mirrors notes-tasks TASK_STATUSES). */
export const TRIAGE_LABELS = ["action", "waiting", "archive"] as const;
export type TriageLabel = (typeof TRIAGE_LABELS)[number];

export interface MessageRecord {
  id: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  triage: TriageLabel;
  createdAt: string;
}

/** A raw, unclassified message as fetched from the IMAP transport (pre-triage,
 *  pre-persistence). */
export interface RawEmailMessage {
  uid: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html?: string;
}

export interface SendInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
}

export function sanitizeTriageLabel(raw: unknown): TriageLabel {
  if (typeof raw !== "string" || !(TRIAGE_LABELS as readonly string[]).includes(raw)) {
    throw new Error(`invalid triage label (allowed: ${TRIAGE_LABELS.join(", ")})`);
  }
  return raw as TriageLabel;
}

/** Folder names are IMAP mailbox paths — reject empty/whitespace and path-
 *  traversal shapes (defense-in-depth; folder is also used to build the cache
 *  row id, never a filesystem path). */
export function sanitizeFolder(raw: unknown): string {
  const folder = typeof raw === "string" ? raw.trim() : "";
  if (!folder || folder.includes("..") || folder.includes("//")) {
    throw new Error("invalid folder (must be a non-empty IMAP mailbox path)");
  }
  return folder;
}

export function parseTriageInput(body: unknown): { label: TriageLabel } {
  const label = sanitizeTriageLabel((body as { label?: unknown })?.label);
  return { label };
}

export function parseDraftInput(body: unknown): { instruction: string } {
  const raw = (body as { instruction?: unknown })?.instruction;
  if (raw !== undefined && typeof raw !== "string") {
    throw new Error("field 'instruction' must be a string");
  }
  return { instruction: typeof raw === "string" ? raw : "" };
}

// Loose but honest email-shape check — not full RFC 5322, just enough to
// reject obvious garbage before it reaches SMTP (real bounce handling is the
// SMTP server's job).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAddressList(raw: unknown, field: string, required: boolean): string[] {
  if (raw === undefined) {
    if (required) throw new Error(`field '${field}' must be a non-empty array of email addresses`);
    return [];
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((a) => typeof a !== "string" || !EMAIL_RE.test(a))) {
    throw new Error(`field '${field}' must be a non-empty array of valid email addresses`);
  }
  return raw as string[];
}

/** Validate a POST /send body — the SMTP-privileged action, so honest 400s
 *  before any transport is touched (never a silent coercion). */
export function parseSendInput(body: unknown): SendInput {
  const b = (body ?? {}) as { to?: unknown; cc?: unknown; bcc?: unknown; subject?: unknown; text?: unknown; inReplyTo?: unknown };
  const to = parseAddressList(b.to, "to", true);
  const cc = b.cc !== undefined ? parseAddressList(b.cc, "cc", false) : undefined;
  const bcc = b.bcc !== undefined ? parseAddressList(b.bcc, "bcc", false) : undefined;
  if (typeof b.subject !== "string" || b.subject.trim() === "") {
    throw new Error("field 'subject' must be a non-empty string");
  }
  if (typeof b.text !== "string" || b.text.trim() === "") {
    throw new Error("field 'text' must be a non-empty string");
  }
  if (b.inReplyTo !== undefined && typeof b.inReplyTo !== "string") {
    throw new Error("field 'inReplyTo' must be a string");
  }
  return {
    to,
    ...(cc && cc.length ? { cc } : {}),
    ...(bcc && bcc.length ? { bcc } : {}),
    subject: b.subject.trim(),
    text: b.text,
    ...(typeof b.inReplyTo === "string" ? { inReplyTo: b.inReplyTo } : {}),
  };
}
