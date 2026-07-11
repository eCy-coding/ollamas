// O3 documents module service — document processor (PDF/office/markdown → text,
// docs/odyssey/05-features/documents.md FAZ1) + thin business layer over ./store
// (the only file touching persistence, via _core/store). Parsing libraries are
// pure-JS (unpdf/mammoth/xlsx/marked — no native binding, SEA-safe, T0.1) and are
// dynamic-imported so a missing/broken optional dependency degrades to a typed
// ProcessingError instead of crashing the request (PIPELINE-LESSONS discipline).
import { getVectorCollection } from "../_core/store";
import {
  type DocKind,
  type DocumentRecord,
  type SheetData,
  detectKind,
  ProcessingError,
  UnsupportedDocumentError,
  validateUpload,
} from "./schema";
import * as store from "./store";

/** LLM-context guard (K3 of the plan): cap extracted text so a huge PDF/XLSX
 *  never blows up downstream context windows. */
export const MAX_EXTRACT_CHARS = 500_000;

export interface ExtractResult {
  kind: DocKind;
  text: string;
  html?: string;
  pages?: number;
  sheets?: SheetData[];
  meta: { bytes: number; truncated: boolean };
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXTRACT_CHARS), truncated: true };
}

/** Minimal, dependency-free HTML sanitizer for rendered markdown (P10 — no
 *  jsdom/dompurify: avoids the SEA-bundling risk flagged in the plan's K2,
 *  keeps the surface small and testable). Strips <script>/<style> blocks,
 *  on* event-handler attributes, and javascript: URLs. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

async function extractPdf(buf: Buffer): Promise<{ text: string; pages: number }> {
  try {
    const unpdf = await import("unpdf");
    const { text, totalPages } = await unpdf.extractText(new Uint8Array(buf), { mergePages: true });
    return { text, pages: totalPages };
  } catch (e) {
    throw new ProcessingError(`PDF extraction failed: ${(e as Error).message}`);
  }
}

async function extractDocx(buf: Buffer): Promise<{ text: string; html: string }> {
  try {
    // Node's CJS→ESM interop copies mammoth's named exports onto the module
    // namespace object itself (no `.default` indirection needed here).
    const mammoth = await import("mammoth");
    const [{ value: html }, { value: text }] = await Promise.all([
      mammoth.convertToHtml({ buffer: buf }),
      mammoth.extractRawText({ buffer: buf }),
    ]);
    return { text, html };
  } catch (e) {
    throw new ProcessingError(`DOCX extraction failed: ${(e as Error).message}`);
  }
}

async function extractXlsx(buf: Buffer): Promise<{ sheets: SheetData[]; text: string }> {
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheets: SheetData[] = wb.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][];
      return { name, rows: rows.map((r) => r.map((c) => (c === undefined || c === null ? "" : String(c)))) };
    });
    const text = sheets.map((s) => `# ${s.name}\n` + s.rows.map((r) => r.join("\t")).join("\n")).join("\n\n");
    return { sheets, text };
  } catch (e) {
    throw new ProcessingError(`XLSX extraction failed: ${(e as Error).message}`);
  }
}

async function extractMarkdown(buf: Buffer): Promise<{ text: string; html: string }> {
  const text = buf.toString("utf-8");
  try {
    const { marked } = await import("marked");
    const rendered = await marked.parse(text);
    return { text, html: sanitizeHtml(rendered) };
  } catch (e) {
    throw new ProcessingError(`Markdown rendering failed: ${(e as Error).message}`);
  }
}

/** Parse a document buffer of a known `kind` into normalized text/html/structure.
 *  Unknown kind → UnsupportedDocumentError; a corrupt file or missing optional
 *  parser dependency → ProcessingError. Never throws a raw/untyped error. */
export async function extractText(kind: DocKind, buf: Buffer): Promise<ExtractResult> {
  if (kind === "unknown") {
    throw new UnsupportedDocumentError("unsupported document kind — no parser available for this file type");
  }
  if (kind === "text") {
    const { text, truncated } = truncate(buf.toString("utf-8"));
    return { kind, text, meta: { bytes: buf.length, truncated } };
  }
  if (kind === "markdown") {
    const { text, html } = await extractMarkdown(buf);
    const t = truncate(text);
    return { kind, text: t.text, html, meta: { bytes: buf.length, truncated: t.truncated } };
  }
  if (kind === "pdf") {
    const { text, pages } = await extractPdf(buf);
    const t = truncate(text);
    return { kind, text: t.text, pages, meta: { bytes: buf.length, truncated: t.truncated } };
  }
  if (kind === "docx") {
    const { text, html } = await extractDocx(buf);
    const t = truncate(text);
    return { kind, text: t.text, html, meta: { bytes: buf.length, truncated: t.truncated } };
  }
  if (kind === "xlsx") {
    const { sheets, text } = await extractXlsx(buf);
    const t = truncate(text);
    return { kind, text: t.text, sheets, meta: { bytes: buf.length, truncated: t.truncated } };
  }
  throw new UnsupportedDocumentError(`unsupported document kind '${kind}'`);
}

/** Optional best-effort RAG ingest (K8/plan §2 "opsiyonel"): gated behind
 *  DOCUMENTS_RAG=1 so tests/CI never hit the network by default. Any failure
 *  (embedder unreachable, etc.) is swallowed — search is a bonus, never a
 *  blocker for the upload itself (graceful-by-design, mirrors cookbook K10). */
export async function ragIndexDocument(
  id: string,
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (env.DOCUMENTS_RAG !== "1" || !text.trim()) return false;
  try {
    const collection = getVectorCollection("documents");
    await collection.upsert(id, text);
    return true;
  } catch {
    return false;
  }
}

/** Validate → detect kind → extract (best-effort) → persist. Extraction
 *  failures never fail the upload itself (graceful — FAZ1 requirement);
 *  the record is stored with `extractError` set and empty text instead. */
export async function createDocument(
  name: string,
  buf: Buffer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DocumentRecord> {
  validateUpload(name, buf, env);
  const kind = detectKind(name, buf);
  let extracted: ExtractResult | null = null;
  let extractError: string | undefined;
  try {
    extracted = await extractText(kind, buf);
  } catch (e) {
    extractError = (e as Error).message;
  }
  const record = await store.insertDocument({
    name,
    kind,
    mime: mimeFor(kind),
    bytes: buf.length,
    text: extracted?.text ?? "",
    html: extracted?.html,
    pages: extracted?.pages,
    sheets: extracted?.sheets,
    truncated: extracted?.meta.truncated ?? false,
    extractError,
  });
  if (extracted?.text) void ragIndexDocument(record.id, extracted.text, env);
  return record;
}

function mimeFor(kind: DocKind): string {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "markdown":
      return "text/markdown";
    case "text":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export async function listDocuments(filter: { kind?: DocKind; q?: string } = {}): Promise<DocumentRecord[]> {
  const all = await store.selectDocuments();
  let out = all;
  if (filter.kind) out = out.filter((d) => d.kind === filter.kind);
  if (filter.q) {
    const q = filter.q.toLowerCase();
    out = out.filter((d) => d.name.toLowerCase().includes(q) || d.text.toLowerCase().includes(q));
  }
  return out;
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  return store.selectDocument(id);
}

export async function deleteDocument(id: string): Promise<boolean> {
  return store.removeDocument(id);
}
