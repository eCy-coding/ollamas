// O6 calendar module (docs/odyssey/05-features/calendar-caldav.md) — mirrors
// server/modules/notes-tasks/index.ts: a ModuleDef with a toggle
// (MODULE_CALENDAR, default OFF), a tab manifest, routes mounted under
// /api/modules/calendar (inherits localOwnerGuard via the single /api/modules
// prefix — INV-O0-1), and its own migration (v10 — claimed off the GLOBAL
// ledger in ../registry.ts, KN-A7 uniqueness enforced on the combined list).
//
// Label key deviation (see PROGRESS/handoff): "app.tab.calendar" already exists
// in src/locales/{en,tr}.ts for the PRE-EXISTING static "calendar" tab in
// App.tsx (GoogleCalendarBrowser, read-only Google feed — untouched by this
// module). Reusing that key would silently overwrite its "Google Calendar"
// label for an unrelated surface, so this module's tab uses the distinct key
// "app.tab.calendarSync" instead. The two tabs render side-by-side without
// runtime collision (App.tsx namespaces module tabs as "module:<id>").
import { defineModule } from "../registry";
import { mountCalendarRoutes } from "./router";
import { MIGRATION_V10_CALENDAR } from "./store";

export const calendarModule = defineModule({
  id: "calendar",
  envFlag: "MODULE_CALENDAR",
  tab: { labelKey: "app.tab.calendarSync", icon: "CalendarDays" },
  mountRoutes: mountCalendarRoutes,
  migrations: [MIGRATION_V10_CALENDAR],
});
