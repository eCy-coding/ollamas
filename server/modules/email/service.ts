// O4 email module service (docs/odyssey/05-features/email-mcp.md) — thin
// business layer over ./store, with the IMAP/SMTP/AI seams injected so unit
// tests never touch a real mailbox (mirrors cookbook's HardwareProbe / demo's
// _setDemoEmbedder injection pattern). Real transports (imapflow/nodemailer)
// are constructed lazily from env — graceful when unconfigured (KN-O2-style:
// missing config → null transport, never a crash).
import { generateText } from "../../ai";
import * as store from "./store";
import type { MessageRecord, RawEmailMessage, SendInput, TriageLabel } from "./schema";

// ── Rule-based triage (pure, deterministic, no AI) ───────────────────────────
// A cheap, honest first pass — no fabricated confidence score, just keyword
// signal. AI (summarize/draft) layers on top for the messages the user opens;
// triage runs on EVERY synced message so it must stay $0 and instant.
const ACTION_KEYWORDS = [/\bplease\b/i, /\basap\b/i, /\breview\b/i, /\bapprove\b/i, /\burgent\b/i, /\bneed(s)? your\b/i, /\bcan you\b/i, /\bblocks?\b/i];
const WAITING_KEYWORDS = [/\bwaiting\b/i, /\bfollow(ing)?[\s-]?up\b/i, /\bany update\b/i, /\bpending\b/i, /\bstill waiting\b/i];

export function triageClassify(msg: { subject: string; text: string }): TriageLabel {
  const hay = `${msg.subject}\n${msg.text}`;
  if (ACTION_KEYWORDS.some((re) => re.test(hay))) return "action";
  if (WAITING_KEYWORDS.some((re) => re.test(hay))) return "waiting";
  return "archive";
}

// ── Injectable transports (the ONLY seam tests use) ──────────────────────────

export interface ImapTransport {
  listFolders(): Promise<string[]>;
  fetchMessages(folder: string, limit?: number): Promise<RawEmailMessage[]>;
}

export interface SmtpTransport {
  sendMail(input: SendInput): Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

export type AiCall = (prompt: string) => Promise<string>;

export interface EmailDeps {
  imap: ImapTransport | null;
  smtp: SmtpTransport | null;
  aiCall: AiCall;
}

const defaultAiCall: AiCall = (prompt) => generateText(prompt);

// ── Config (env-driven, kapalı-varsayılan — R2/R3 note in email-mcp.md §6) ───

export interface ImapConnConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface SmtpConnConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface EmailConnConfig {
  imap: ImapConnConfig | null;
  smtp: SmtpConnConfig | null;
}

/** Reads connectivity config from env. Deliberately NEVER includes the
 *  password field in the returned shape (security principle inherited from
 *  integrations.ts: secrets are read directly from env by the transport
 *  factory, never surfaced in a value that could be logged/returned by a
 *  route). Missing IMAP host/user/password → imap:null (graceful, not crash);
 *  same for SMTP host. */
export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConnConfig {
  const imapHost = env.EMAIL_IMAP_HOST;
  const imapUser = env.EMAIL_IMAP_USER;
  const imapPass = env.EMAIL_IMAP_PASSWORD;
  const imap: ImapConnConfig | null =
    imapHost && imapUser && imapPass
      ? {
          host: imapHost,
          port: Number(env.EMAIL_IMAP_PORT) || 993,
          secure: env.EMAIL_IMAP_SECURE !== "0",
          user: imapUser,
        }
      : null;

  const smtpHost = env.EMAIL_SMTP_HOST;
  const smtp: SmtpConnConfig | null = smtpHost
    ? {
        host: smtpHost,
        port: Number(env.EMAIL_SMTP_PORT) || 587,
        secure: env.EMAIL_SMTP_SECURE === "1",
        user: env.EMAIL_SMTP_USER || imapUser || "",
      }
    : null;

  return { imap, smtp };
}

// ── Real transport factories (lazy — only constructed when config exists) ───

function createRealImapTransport(cfg: ImapConnConfig, pass: string): ImapTransport {
  return {
    async listFolders() {
      const { ImapFlow } = await import("imapflow");
      const client = new ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass },
        logger: false,
      });
      await client.connect();
      try {
        const list = await client.list();
        return list.map((m) => m.path);
      } finally {
        await client.logout().catch(() => {});
      }
    },
    async fetchMessages(folder, limit = 20) {
      const { ImapFlow } = await import("imapflow");
      const { simpleParser } = await import("mailparser");
      const client = new ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass },
        logger: false,
      });
      await client.connect();
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const uids = await client.search({ all: true });
          const recent = (Array.isArray(uids) ? uids : []).slice(-limit);
          const out: RawEmailMessage[] = [];
          if (recent.length === 0) return out;
          for await (const msg of client.fetch(recent, { source: true })) {
            const parsed = await simpleParser(msg.source);
            const toText = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(", ") : parsed.to.text) : "";
            out.push({
              uid: String(msg.uid),
              from: parsed.from?.text ?? "",
              to: toText,
              subject: parsed.subject ?? "",
              date: (parsed.date ?? new Date()).toISOString(),
              text: parsed.text ?? "",
              ...(typeof parsed.html === "string" ? { html: parsed.html } : {}),
            });
          }
          return out;
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => {});
      }
    },
  };
}

function createRealSmtpTransport(cfg: SmtpConnConfig, pass: string): SmtpTransport {
  return {
    async sendMail(input) {
      try {
        const { default: nodemailer } = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          auth: cfg.user ? { user: cfg.user, pass } : undefined,
        });
        const info = await transporter.sendMail({
          from: cfg.user,
          to: input.to.join(","),
          ...(input.cc ? { cc: input.cc.join(",") } : {}),
          ...(input.bcc ? { bcc: input.bcc.join(",") } : {}),
          subject: input.subject,
          text: input.text,
          ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        });
        return { ok: true, messageId: String(info.messageId) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

function buildRealDeps(env: NodeJS.ProcessEnv = process.env): EmailDeps {
  const cfg = loadEmailConfig(env);
  return {
    imap: cfg.imap ? createRealImapTransport(cfg.imap, env.EMAIL_IMAP_PASSWORD ?? "") : null,
    smtp: cfg.smtp ? createRealSmtpTransport(cfg.smtp, env.EMAIL_SMTP_PASSWORD ?? env.EMAIL_IMAP_PASSWORD ?? "") : null,
    aiCall: defaultAiCall,
  };
}

// ── Deps override seam (test-only; mirrors demo's _setDemoEmbedder) ─────────

let overrideDeps: EmailDeps | null = null;

export function _setEmailDeps(deps: Partial<EmailDeps>): void {
  overrideDeps = { imap: null, smtp: null, aiCall: defaultAiCall, ...overrideDeps, ...deps };
}

export function _resetEmailDeps(): void {
  overrideDeps = null;
}

function getDeps(): EmailDeps {
  return overrideDeps ?? buildRealDeps(process.env);
}

// ── AI summary/draft (pure w.r.t. transports — take an injected aiCall) ─────

export interface SummaryResult {
  summary: string;
  bullets: string[];
  suggestedAction?: string;
}

/** Strips a ```json fence if the model wraps its answer in one. */
function extractJsonPayload(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

export async function summarizeMessage(
  msg: { subject: string; from: string; text: string },
  aiCall: AiCall,
): Promise<SummaryResult> {
  const prompt =
    `Summarize this email as JSON: {"summary": string, "bullets": string[], "suggestedAction": string}.\n` +
    `From: ${msg.from}\nSubject: ${msg.subject}\n\n${msg.text}`;
  const raw = await aiCall(prompt);
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<SummaryResult>;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : raw.trim(),
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.filter((b): b is string => typeof b === "string") : [],
      ...(typeof parsed.suggestedAction === "string" ? { suggestedAction: parsed.suggestedAction } : {}),
    };
  } catch {
    // Malformed JSON from the model — safe fallback, never throw (email-mcp.md
    // Adım 5: "deterministik parse (JSON dönüşü bozuksa güvenli fallback)").
    return { summary: raw.trim(), bullets: [] };
  }
}

/** Drafts a reply. Deliberately takes NO smtp transport — it is structurally
 *  impossible for this function to send mail (email-mcp.md Adım 6: "hiçbir
 *  SMTP çağrısı yapılmaz"). */
export async function draftReply(
  msg: { subject: string; from: string; text: string },
  instruction: string,
  aiCall: AiCall,
): Promise<string> {
  const prompt =
    `Draft a reply to this email. ${instruction ? `Instruction: ${instruction}. ` : ""}` +
    `Reply with the draft text only, no preamble.\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\n${msg.text}`;
  const draft = await aiCall(prompt);
  return draft.trim();
}

// ── SMTP send (the ONE privileged action) ────────────────────────────────────

export async function sendEmail(
  input: SendInput,
  smtp: SmtpTransport | null,
): Promise<{ ok: true; messageId?: string } | { ok: false; status: number; error: string }> {
  if (!smtp) {
    return { ok: false, status: 503, error: "SMTP not configured (set EMAIL_SMTP_HOST)" };
  }
  const r = await smtp.sendMail(input);
  if (!r.ok) {
    return { ok: false, status: 502, error: r.error ?? "send failed" };
  }
  return { ok: true, ...(r.messageId ? { messageId: r.messageId } : {}) };
}

// ── Route-facing service functions (router stays thin) ───────────────────────

export async function getStatus(): Promise<{ connected: boolean; folders?: string[]; error?: string }> {
  const deps = getDeps();
  if (!deps.imap) return { connected: false };
  try {
    const folders = await deps.imap.listFolders();
    return { connected: true, folders };
  } catch (e) {
    return { connected: false, error: (e as Error).message };
  }
}

export async function syncMessages(
  folder: string,
): Promise<{ messages: MessageRecord[]; connected: boolean; error?: string }> {
  const deps = getDeps();
  if (!deps.imap) {
    return { messages: await store.selectMessages(folder), connected: false };
  }
  try {
    const raw = await deps.imap.fetchMessages(folder);
    const messages = await store.upsertMessages(folder, raw, triageClassify);
    return { messages, connected: true };
  } catch (e) {
    return { messages: await store.selectMessages(folder), connected: false, error: (e as Error).message };
  }
}

export async function getMessage(id: string): Promise<MessageRecord | undefined> {
  return store.selectMessage(id);
}

export async function setTriage(id: string, label: TriageLabel): Promise<MessageRecord | undefined> {
  return store.updateTriage(id, label);
}

export async function summarize(id: string): Promise<SummaryResult | undefined> {
  const msg = await store.selectMessage(id);
  if (!msg) return undefined;
  return summarizeMessage({ subject: msg.subject, from: msg.from, text: msg.bodyText }, getDeps().aiCall);
}

export async function draft(id: string, instruction: string): Promise<{ draft: string } | undefined> {
  const msg = await store.selectMessage(id);
  if (!msg) return undefined;
  const draftText = await draftReply({ subject: msg.subject, from: msg.from, text: msg.bodyText }, instruction, getDeps().aiCall);
  return { draft: draftText };
}

export async function send(
  input: SendInput,
): Promise<{ ok: true; messageId?: string } | { ok: false; status: number; error: string }> {
  return sendEmail(input, getDeps().smtp);
}
