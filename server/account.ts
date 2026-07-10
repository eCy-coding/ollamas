// M-047 — GDPR self-service account routes (V6). A tenant, authenticated by its
// own API key, can EXPORT all of its data (portability) or DELETE its account
// (right to erasure). Mounted with the injectable-middleware pattern used by
// registerContractRoutes so it is unit-testable without a full server boot.
import type { Express, RequestHandler } from "express";
import { exportTenantData, eraseTenantData, recordAudit } from "./store";

export function registerAccountRoutes(app: Express, requireAuth: RequestHandler): void {
  // GET /api/account/export — full JSON dump of the caller's tenant data.
  app.get("/api/account/export", requireAuth, async (req, res) => {
    const tenantId = (req as any).tenant?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "key required" });
    const data = await exportTenantData(String(tenantId));
    res.json(data);
  });

  // POST /api/account/delete — irreversible self-service erasure of the caller's
  // tenant. The erasure ITSELF is audited (fresh row, written after the wipe) so
  // there is a compliance trail even though the tenant's prior audit rows are removed.
  app.post("/api/account/delete", requireAuth, async (req, res) => {
    const tenantId = (req as any).tenant?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "key required" });
    const counts = await eraseTenantData(String(tenantId));
    await recordAudit({ tenantId: String(tenantId), tool: "account.erase", tier: "privileged", ok: true });
    res.json({ deleted: true, counts });
  });
}
