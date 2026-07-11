// O4 email module (docs/odyssey/05-features/email-mcp.md) — mirrors
// server/modules/cookbook/index.ts: a ModuleDef with a toggle (MODULE_EMAIL,
// default OFF), a tab manifest, routes mounted under /api/modules/email
// (inherits localOwnerGuard via the single /api/modules prefix — INV-O0-1),
// and its own migration (v11, claimed off the GLOBAL ledger in ../registry.ts
// — see store.ts header for why v11 was free despite the ledger comment).
import { defineModule } from "../registry";
import { mountEmailRoutes } from "./router";
import { MIGRATION_V11_EMAIL } from "./store";

export const emailModule = defineModule({
  id: "email",
  envFlag: "MODULE_EMAIL",
  tab: { labelKey: "app.tab.email", icon: "Mail" },
  mountRoutes: mountEmailRoutes,
  migrations: [MIGRATION_V11_EMAIL],
});
