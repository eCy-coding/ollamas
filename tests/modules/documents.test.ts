// O3 documents module (docs/odyssey/05-features/documents.md) — mirrors
// tests/modules/notes-tasks.test.ts: schema validation (pure), extraction
// (pdf/docx/xlsx/markdown/text, real fixtures — FAZ1 K4), store/service CRUD
// (real SQLite via _core/store, restart-persist), route + toggle (functional),
// upload validation (allowlist/magic-byte spoof/size — FAZ3), and the
// localOwnerGuard invariant (SAAS_ENFORCE=1 → 403).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../../server/modules/documents"; // side-effect: register the real module
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import {
  detectKind,
  parseUploadInput,
  validateUpload,
  allowedExtensions,
  maxUploadBytes,
  looksLikeExecutable,
  UploadRejectedError,
} from "../../server/modules/documents/schema";
import {
  extractText,
  sanitizeHtml,
  createDocument,
  listDocuments,
  getDocument,
  deleteDocument,
} from "../../server/modules/documents/service";
import { UnsupportedDocumentError, ProcessingError } from "../../server/modules/documents/schema";
import { closeStore } from "../../server/store";
import { buildMinimalDocx, buildMinimalPdf, buildCorruptPdf } from "./documents-fixtures";

// Same gotcha as tests/modules/notes-tasks.test.ts: getModuleDb() runs the
// combined core+module migrations exactly ONCE per process — one shared tmp
// sqlite file for this entire test file.
const sharedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o3-documents-"));
beforeAll(() => {
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = path.join(sharedTmp, "saas.db");
});
afterAll(async () => {
  await closeStore();
  fs.rmSync(sharedTmp, { recursive: true, force: true });
});

// ── Schema validation (pure, P1/P3) ─────────────────────────────────────────
describe("O3 documents — schema validation + upload guard (pure)", () => {
  test("detectKind: extension is authoritative; falls back to magic-byte sniff", () => {
    expect(detectKind("notes.md", Buffer.from("# hi"))).toBe("markdown");
    expect(detectKind("readme.txt", Buffer.from("hi"))).toBe("text");
    expect(detectKind("report.pdf", buildMinimalPdf())).toBe("pdf");
    expect(detectKind("brief.docx", buildMinimalDocx())).toBe("docx");
    expect(detectKind("mystery", buildMinimalPdf())).toBe("pdf"); // %PDF magic, no ext
    expect(detectKind("mystery.bin", Buffer.from([0, 1, 2, 3]))).toBe("unknown");
  });

  test("parseUploadInput requires name + non-empty base64 content", () => {
    expect(() => parseUploadInput({})).toThrow();
    expect(() => parseUploadInput({ name: "a.md" })).toThrow();
    expect(() => parseUploadInput({ name: "a.md", contentBase64: "" })).toThrow();
    const { name, buf } = parseUploadInput({ name: "a.md", contentBase64: Buffer.from("hi").toString("base64") });
    expect(name).toBe("a.md");
    expect(buf.toString("utf-8")).toBe("hi");
  });

  test("allowedExtensions/maxUploadBytes: config-driven via env (P5)", () => {
    expect(allowedExtensions({} as NodeJS.ProcessEnv)).toContain("pdf");
    expect(allowedExtensions({ DOCUMENTS_ALLOWED_EXT: "md,.txt" } as unknown as NodeJS.ProcessEnv)).toEqual([
      "md",
      "txt",
    ]);
    expect(maxUploadBytes({} as NodeJS.ProcessEnv)).toBe(25 * 1024 * 1024);
    expect(maxUploadBytes({ DOCUMENTS_MAX_MB: "1" } as unknown as NodeJS.ProcessEnv)).toBe(1024 * 1024);
  });

  test("validateUpload: allowed ext + clean content passes", () => {
    expect(() => validateUpload("report.pdf", buildMinimalPdf())).not.toThrow();
  });

  test("validateUpload: disallowed extension (.exe/.sh) → 415", () => {
    try {
      validateUpload("virus.exe", Buffer.from("x"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UploadRejectedError);
      expect((e as UploadRejectedError).status).toBe(415);
    }
  });

  test("validateUpload: allowed extension but exe magic-byte content → 415 (spoof guard)", () => {
    expect(looksLikeExecutable(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(true);
    try {
      validateUpload("report.pdf", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UploadRejectedError);
      expect((e as UploadRejectedError).status).toBe(415);
    }
  });

  test("validateUpload: over the per-tier size limit → 413", () => {
    const big = Buffer.alloc(2048, 0x41);
    try {
      validateUpload("notes.txt", big, { DOCUMENTS_MAX_MB: "0.001" } as unknown as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UploadRejectedError);
      expect((e as UploadRejectedError).status).toBe(413);
    }
  });
});

// ── Document processor / extraction (FAZ1, P1) ──────────────────────────────
describe("O3 documents — extractText (PDF/DOCX/XLSX/Markdown/text)", () => {
  test("markdown → { text, html } with sanitized script/style stripped", async () => {
    const md = "# Title\n\nSome **bold** text.\n\n<script>alert(1)</script>";
    const res = await extractText("markdown", Buffer.from(md, "utf-8"));
    expect(res.text).toContain("# Title");
    expect(res.html).toContain("<h1>Title</h1>");
    expect(res.html).not.toContain("<script>");
  });

  test("sanitizeHtml strips <script>, on*= handlers, and javascript: URLs", () => {
    const dirty = `<div onclick="evil()">hi</div><script>bad()</script><a href="javascript:evil()">x</a>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("onclick=");
    expect(clean).not.toContain("javascript:");
  });

  test("text → raw utf-8 passthrough", async () => {
    const res = await extractText("text", Buffer.from("plain content", "utf-8"));
    expect(res.text).toBe("plain content");
  });

  test("pdf fixture → extracted text substring + page count", async () => {
    const res = await extractText("pdf", buildMinimalPdf("Hello PDF fixture"));
    expect(res.text).toContain("Hello PDF fixture");
    expect(res.pages).toBe(1);
  }, 20_000);

  test("docx fixture → paragraph text extracted", async () => {
    const res = await extractText("docx", buildMinimalDocx("Hello DOCX fixture"));
    expect(res.text).toContain("Hello DOCX fixture");
  });

  test("xlsx fixture → { sheets: [{ name, rows }] }", async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["a", "b"],
      ["1", "2"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const res = await extractText("xlsx", buf);
    expect(res.sheets?.[0].name).toBe("Sheet1");
    expect(res.sheets?.[0].rows[0]).toEqual(["a", "b"]);
  });

  test("unknown kind → UnsupportedDocumentError (not a crash)", async () => {
    await expect(extractText("unknown", Buffer.from("???"))).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });

  test("corrupt PDF → ProcessingError (caught, not a crash)", async () => {
    await expect(extractText("pdf", buildCorruptPdf())).rejects.toBeInstanceOf(ProcessingError);
  }, 20_000);

  test("truncation: extraction beyond MAX_EXTRACT_CHARS is flagged", async () => {
    const huge = "x".repeat(600_000);
    const res = await extractText("text", Buffer.from(huge, "utf-8"));
    expect(res.meta.truncated).toBe(true);
    expect(res.text.length).toBeLessThan(600_000);
  });
});

// ── Store/service CRUD (real SQLite via _core/store, P2) ────────────────────
describe("O3 documents — createDocument → list/get → delete (restart-persist)", () => {
  test("createDocument (markdown) → listDocuments/getDocument → deleteDocument", async () => {
    const doc = await createDocument("hello.md", Buffer.from("# Hi\n\nbody text", "utf-8"));
    expect(doc.id).toBeTruthy();
    expect(doc.kind).toBe("markdown");
    expect(doc.text).toContain("# Hi");
    expect(doc.extractError).toBeUndefined();

    const listed = await listDocuments({});
    expect(listed.map((d) => d.id)).toContain(doc.id);

    const got = await getDocument(doc.id);
    expect(got?.name).toBe("hello.md");

    const bySearch = await listDocuments({ q: "body text" });
    expect(bySearch.map((d) => d.id)).toContain(doc.id);

    const byKind = await listDocuments({ kind: "markdown" });
    expect(byKind.map((d) => d.id)).toContain(doc.id);
    expect((await listDocuments({ kind: "pdf" })).map((d) => d.id)).not.toContain(doc.id);

    const gone = await deleteDocument(doc.id);
    expect(gone).toBe(true);
    expect(await getDocument(doc.id)).toBeUndefined();
    expect(await deleteDocument(doc.id)).toBe(false);
  });

  test("createDocument (pdf fixture) → extracted text + page count persisted", async () => {
    const buf = buildMinimalPdf("Persisted PDF text");
    const doc = await createDocument("archive.pdf", buf);
    expect(doc.kind).toBe("pdf");
    expect(doc.text).toContain("Persisted PDF text");
    expect(doc.pages).toBe(1);
  }, 20_000);

  test("data survives closeStore→re-init (restart-persist, mirrors notes-tasks module)", async () => {
    const doc = await createDocument("persist.md", Buffer.from("# persist me", "utf-8"));
    await closeStore();
    const after = await getDocument(doc.id);
    expect(after?.name).toBe("persist.md");
  });

  test("upload rejection (bad extension) propagates through createDocument", async () => {
    await expect(createDocument("bad.exe", Buffer.from("x"))).rejects.toThrow();
  });
});

// ── Route + toggle (functional, P4) ──────────────────────────────────────────
describe("O3 documents — route + toggle", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    mountEnabledModules(app, { MODULE_DOCUMENTS: "1" } as NodeJS.ProcessEnv);
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("MODULE_DOCUMENTS=1 → module listed in /api/modules", async () => {
    process.env.MODULE_DOCUMENTS = "1";
    expect(enabledModules().map((m) => m.id)).toContain("documents");
    delete process.env.MODULE_DOCUMENTS;
  });

  test("POST (upload) → GET list/:id/:id-extract → DELETE round-trip", async () => {
    const contentBase64 = Buffer.from("# Route test\n\nhello", "utf-8").toString("base64");
    const created = await (
      await fetch(`${base}/api/modules/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "route.md", contentBase64 }),
      })
    ).json();
    expect(created.id).toBeTruthy();
    expect(created.kind).toBe("markdown");

    const list = await (await fetch(`${base}/api/modules/documents`)).json();
    expect(list.documents.map((d: { id: string }) => d.id)).toContain(created.id);

    const got = await fetch(`${base}/api/modules/documents/${created.id}`);
    expect(got.status).toBe(200);

    const extract = await (await fetch(`${base}/api/modules/documents/${created.id}/extract`)).json();
    expect(extract.text).toContain("Route test");

    const delRes = await fetch(`${base}/api/modules/documents/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect((await fetch(`${base}/api/modules/documents/${created.id}`)).status).toBe(404);
  });

  test("POST missing fields → 400 (honest validation)", async () => {
    const res = await fetch(`${base}/api/modules/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST disallowed extension → 415", async () => {
    const res = await fetch(`${base}/api/modules/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad.exe", contentBase64: Buffer.from("x").toString("base64") }),
    });
    expect(res.status).toBe(415);
  });

  test("GET/DELETE unknown id → 404", async () => {
    expect((await fetch(`${base}/api/modules/documents/does-not-exist`)).status).toBe(404);
    expect((await fetch(`${base}/api/modules/documents/does-not-exist`, { method: "DELETE" })).status).toBe(404);
  });

  test("MODULE_DOCUMENTS unset → routes 404 (toggle-off blackout)", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, {} as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/documents`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

// ── localOwnerGuard invariant: /api/modules/documents is 403 under SaaS (P5) ──
describe("O3 documents — localOwnerGuard (SAAS_ENFORCE=1 → 403)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_DOCUMENTS = "1";
    delete process.env.SAAS_ENFORCE;
    const { app } = await import("../../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => {
    delete process.env.SAAS_ENFORCE;
    delete process.env.MODULE_DOCUMENTS;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("SAAS_ENFORCE=1 → /api/modules/documents is 403 (inherits the guard)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules/documents`)).status).toBe(403);
    delete process.env.SAAS_ENFORCE;
  });

  test("SAAS_ENFORCE unset → guard calls next() (not 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    expect((await fetch(`${base}/api/modules/documents`)).status).not.toBe(403);
  });
});
