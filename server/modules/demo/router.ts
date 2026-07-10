// O0 demo module router — mounted by the registry at /api/modules/demo (scoped
// Router, never the raw app → INV-O0-1 holds structurally). Global express.json
// runs before the guard (server.ts) so req.body is parsed here.
import type { Router } from "express";
import { parseItemInput, parseSearchInput } from "./schema";
import { createItem, getItems, search } from "./service";

export function mountDemoRoutes(router: Router): void {
  router.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/items", async (req, res) => {
    let text: string;
    try {
      text = parseItemInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await createItem(text));
  });

  router.get("/items", async (_req, res) => {
    res.json({ items: await getItems() });
  });

  router.post("/search", async (req, res) => {
    let q: string;
    try {
      q = parseSearchInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json({ hits: await search(q) });
  });
}
