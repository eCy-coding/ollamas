// O2 research router — mounted by the registry at /api/modules/research (scoped
// Router; inherits localOwnerGuard via the single /api/modules prefix, INV-O0-1).
// Thin: validate → service → json (cookbook/demo pattern).
import type { Router } from "express";
import { parseResearchInput } from "./schema";
import { runResearchSession } from "./service";
import { listRuns } from "./store";

export function mountResearchRoutes(router: Router): void {
  router.post("/run", async (req, res) => {
    let input: ReturnType<typeof parseResearchInput>;
    try {
      input = parseResearchInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      const result = await runResearchSession(input.question, input.deep);
      res.json(result);
    } catch (e) {
      // The engine itself is fail-soft at every IO boundary; a 500 here means an
      // unexpected programmer error, not a flaky search backend — surface it honestly.
      res.status(500).json({ error: (e as Error).message || "research run failed" });
    }
  });

  router.get("/runs", async (_req, res) => {
    const runs = await listRuns();
    res.json({ runs });
  });
}
