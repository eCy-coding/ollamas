// O8 settings module (docs/odyssey/07-security.md O8.1-O8.5) — mirrors
// server/modules/cookbook/index.ts: a ModuleDef with a toggle (MODULE_SETTINGS,
// default OFF), a tab manifest, routes mounted under /api/modules/settings
// (inherits localOwnerGuard via the single /api/modules prefix — INV-O0-1), and
// its own migration (v14 — see ./store.ts header for why v14, not the v11 the
// registry ledger comment pencils in for "O8 security": the parallel email-panel
// agent claims v11, so this module claims the next free slot instead).
import { defineModule } from "../registry";
import { mountSettingsRoutes } from "./router";
import { MIGRATION_V14_SETTINGS } from "./store";

export const settingsModule = defineModule({
  id: "settings",
  envFlag: "MODULE_SETTINGS",
  tab: { labelKey: "app.tab.settings", icon: "Settings" },
  mountRoutes: mountSettingsRoutes,
  migrations: [MIGRATION_V14_SETTINGS],
});
