// O3 documents router — mounted by the registry at /api/modules/documents
// (scoped Router; inherits localOwnerGuard via the single /api/modules prefix,
// INV-O0-1). Every route is thin: validate → service → json. Mirrors
// server/modules/notes-tasks/router.ts + cookbook/router.ts.
import type { Router } from "express";
import { parseUploadInput, UploadRejectedError, DOC_KINDS, type DocKind } from "./schema";
import { createDocument, listDocuments, getDocument, deleteDocument } from "./service";

function isDocKind(v: string): v is DocKind {
  return (DOC_KINDS as readonly string[]).includes(v);
}

export function mountDocumentsRoutes(router: Router): void {
  router.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const kindRaw = typeof req.query.kind === "string" ? req.query.kind : undefined;
    if (kindRaw && !isDocKind(kindRaw)) {
      res.status(400).json({ error: `invalid kind (allowed: ${DOC_KINDS.join(", ")})` });
      return;
    }
    res.json({ documents: await listDocuments({ q, kind: kindRaw as DocKind | undefined }) });
  });

  router.post("/", async (req, res) => {
    let input: ReturnType<typeof parseUploadInput>;
    try {
      input = parseUploadInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      const doc = await createDocument(input.name, input.buf);
      res.status(201).json(doc);
    } catch (e) {
      if (e instanceof UploadRejectedError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.get("/:id", async (req, res) => {
    const doc = await getDocument(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    res.json(doc);
  });

  // Viewer/editor pull (FAZ4): the already-extracted fields for a stored
  // document — no recompute, no path-based traversal surface (self-contained
  // module store, distinct from the workspace-path /api/documents/extract
  // shape in the plan's Faz 2 sketch).
  router.get("/:id/extract", async (req, res) => {
    const doc = await getDocument(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    res.json({
      kind: doc.kind,
      text: doc.text,
      html: doc.html,
      pages: doc.pages,
      sheets: doc.sheets,
      truncated: doc.truncated,
      extractError: doc.extractError,
    });
  });

  router.delete("/:id", async (req, res) => {
    const ok = await deleteDocument(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    res.json({ ok: true });
  });
}
