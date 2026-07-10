// O7 cookbook module (docs/odyssey/05-features/cookbook.md) — the PILOT panel of
// the HANDOFF-PIPELINE. Mirrors server/modules/demo/index.ts: a ModuleDef with a
// toggle (MODULE_COOKBOOK, default OFF), a tab manifest, and routes mounted under
// /api/modules/cookbook (inherits localOwnerGuard via the single /api/modules
// prefix — INV-O0-1). Headless of DB migrations for now (K10: bench cache is
// in-memory, persisted:false) so it declares none.
import { defineModule } from "../registry";
import { mountCookbookRoutes } from "./router";

export const cookbookModule = defineModule({
  id: "cookbook",
  envFlag: "MODULE_COOKBOOK",
  tab: { labelKey: "app.tab.cookbook", icon: "BookOpen" },
  mountRoutes: mountCookbookRoutes,
});
