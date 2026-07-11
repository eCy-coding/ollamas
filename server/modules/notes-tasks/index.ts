// O5 notes-tasks module (docs/odyssey/05-features/notes-tasks.md) — mirrors
// server/modules/cookbook/index.ts: a ModuleDef with a toggle (MODULE_NOTES_TASKS,
// default OFF), a tab manifest, routes mounted under /api/modules/notes-tasks
// (inherits localOwnerGuard via the single /api/modules prefix — INV-O0-1), and
// its own migrations (v8 notes+tasks, v9 reminders — versions claimed off the
// GLOBAL ledger in ../registry.ts, KN-A7 uniqueness enforced on the combined list).
import { defineModule } from "../registry";
import { mountNotesTasksRoutes } from "./router";
import { MIGRATION_V8_NOTES_TASKS, MIGRATION_V9_REMINDERS } from "./store";

export const notesTasksModule = defineModule({
  id: "notes-tasks",
  envFlag: "MODULE_NOTES_TASKS",
  tab: { labelKey: "app.tab.notesTasks", icon: "NotebookPen" },
  mountRoutes: mountNotesTasksRoutes,
  migrations: [MIGRATION_V8_NOTES_TASKS, MIGRATION_V9_REMINDERS],
});
