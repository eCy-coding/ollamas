// O4 email router — mounted by the registry at /api/modules/email (scoped
// Router; inherits localOwnerGuard via the single /api/modules prefix,
// INV-O0-1 — guard-test EDIT NOT NEEDED, PIPELINE-LESSONS #5). Every route is
// thin: validate → service → json. `send` is the one SMTP-privileged action;
// everything else (search/get/triage/summarize/draft) is read-only or
// local-only ($0 AI).
import type { Router } from "express";
import { parseDraftInput, parseSendInput, parseTriageInput, sanitizeFolder } from "./schema";
import { draft, getMessage, getStatus, send, setTriage, summarize, syncMessages } from "./service";

export function mountEmailRoutes(router: Router): void {
  router.get("/status", async (_req, res) => {
    res.json(await getStatus());
  });

  router.get("/messages", async (req, res) => {
    let folder: string;
    try {
      folder = sanitizeFolder(req.query.folder);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await syncMessages(folder));
  });

  router.get("/messages/:id", async (req, res) => {
    const msg = await getMessage(req.params.id);
    if (!msg) {
      res.status(404).json({ error: "message not found" });
      return;
    }
    res.json(msg);
  });

  router.post("/messages/:id/triage", async (req, res) => {
    let input: ReturnType<typeof parseTriageInput>;
    try {
      input = parseTriageInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const updated = await setTriage(req.params.id, input.label);
    if (!updated) {
      res.status(404).json({ error: "message not found" });
      return;
    }
    res.json(updated);
  });

  // Safe — returns AI text only, never sends (design.html "AI Summary" card).
  router.post("/messages/:id/summarize", async (req, res) => {
    const out = await summarize(req.params.id);
    if (!out) {
      res.status(404).json({ error: "message not found" });
      return;
    }
    res.json(out);
  });

  // Safe — returns a draft string only, never touches SMTP (design.html docked
  // "AI draft ready" bar).
  router.post("/messages/:id/draft", async (req, res) => {
    let input: ReturnType<typeof parseDraftInput>;
    try {
      input = parseDraftInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const out = await draft(req.params.id, input.instruction);
    if (!out) {
      res.status(404).json({ error: "message not found" });
      return;
    }
    res.json(out);
  });

  // THE privileged action (design.html compose modal "Send" button).
  router.post("/send", async (req, res) => {
    let input: ReturnType<typeof parseSendInput>;
    try {
      input = parseSendInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const r = await send(input);
    // Discriminated-union narrowing on a boolean `ok` field doesn't narrow in
    // this tsconfig (PIPELINE-LESSONS #1) — check for the error-only field.
    if ("error" in r) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r);
  });
}
