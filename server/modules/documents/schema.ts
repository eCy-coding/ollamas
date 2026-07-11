// O3 documents module — wire types + input validation (honest 400/415/413
// before any work). Mirrors server/modules/notes-tasks/schema.ts /
// cookbook/schema.ts. Types are shared with the frontend DocumentsPanel via
// the /api/modules/documents/* JSON payloads.
// docs/odyssey/05-features/documents.md FAZ0-3: PDF/office/markdown extraction
// + config-driven upload validation (DOCUMENTS_MAX_MB / DOCUMENTS_ALLOWED_EXT).

export const DOC_KINDS = ["pdf", "docx", "xlsx", "markdown", "text", "unknown"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface SheetData {
  name: string;
  rows: string[][];
}

export interface DocumentRecord {
  id: string;
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
  created_at: string;
  updated_at: string;
}

/** Typed error (K-A1): an unrecognized/unsupported document kind — never a raw
 *  500/crash (FAZ1 requirement: "Bilinmeyen/binary uzantı → UnsupportedDocumentError"). */
export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

/** Typed error: parsing started but the library/content failed (corrupt file,
 *  missing optional dependency) — caught, never a crash (FAZ1 "Bozuk PDF"). */
export class ProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}

/** HTTP-status-carrying validation error (upload allowlist/size — FAZ3). */
export class UploadRejectedError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadRejectedError";
    this.status = status;
  }
}

const DEFAULT_ALLOWED_EXT = ["pdf", "docx", "xlsx", "md", "markdown", "txt"];
const DEFAULT_MAX_MB = 25;

/** `.env` DOCUMENTS_ALLOWED_EXT — config-driven allowlist (P5). */
export function allowedExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.DOCUMENTS_ALLOWED_EXT;
  if (!raw || !raw.trim()) return DEFAULT_ALLOWED_EXT;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

/** `.env` DOCUMENTS_MAX_MB — config-driven per-upload size limit (P5). Global
 *  express.raw 1gb limit is untouched (K6) — this is a code-level early-reject. */
export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.DOCUMENTS_MAX_MB);
  const mb = Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MB;
  return Math.round(mb * 1024 * 1024);
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Magic-byte + extension sniff (uzantı + içerik). ZIP-based office formats
 *  (docx/xlsx) share the PK header, so the extension disambiguates between them. */
export function detectKind(name: string, buf: Buffer): DocKind {
  const ext = extOf(name);
  const isPdfMagic = buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "%PDF";
  const isZipMagic =
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);

  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt") return "text";
  if (ext === "pdf") return isPdfMagic || buf.length === 0 ? "pdf" : "pdf"; // extension is authoritative for pdf
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (isPdfMagic) return "pdf";
  if (isZipMagic) return "docx"; // unknown zip office doc — best-effort docx path
  return "unknown";
}

/** "MZ" — Windows PE executable header. Spoof guard (K3): an allowed extension
 *  whose content is actually an executable is rejected regardless (FAZ3). */
export function looksLikeExecutable(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a;
}

/** Validate a { name, contentBase64 } upload body — honest 400 before any work. */
export function parseUploadInput(body: unknown): { name: string; buf: Buffer } {
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("field 'name' must be a non-empty string");
  }
  const contentBase64 = (body as { contentBase64?: unknown })?.contentBase64;
  if (typeof contentBase64 !== "string" || contentBase64.trim() === "") {
    throw new Error("field 'contentBase64' must be a non-empty base64 string");
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(contentBase64, "base64");
  } catch {
    throw new Error("field 'contentBase64' is not valid base64");
  }
  if (buf.length === 0) {
    throw new Error("decoded content is empty");
  }
  return { name: name.trim(), buf };
}

/** Extension allowlist + magic-byte spoof guard + per-upload size limit (FAZ3,
 *  P3). Throws UploadRejectedError (415/413) — never a silent accept. */
export function validateUpload(name: string, buf: Buffer, env: NodeJS.ProcessEnv = process.env): void {
  const ext = extOf(name);
  const allowed = allowedExtensions(env);
  if (!allowed.includes(ext)) {
    throw new UploadRejectedError(415, `file extension '.${ext || "(none)"}' is not allowed (allowed: ${allowed.join(", ")})`);
  }
  if (looksLikeExecutable(buf)) {
    throw new UploadRejectedError(415, "file content looks like an executable (magic-byte spoof rejected)");
  }
  const max = maxUploadBytes(env);
  if (buf.length > max) {
    throw new UploadRejectedError(413, `file exceeds the max upload size (${Math.round(max / 1024 / 1024)} MB)`);
  }
}
