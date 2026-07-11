// O3 documents module (docs/odyssey/05-features/documents.md) — mirrors
// server/modules/notes-tasks/index.ts: a ModuleDef with a toggle
// (MODULE_DOCUMENTS, default OFF), a tab manifest, routes mounted under
// /api/modules/documents (inherits localOwnerGuard via the single /api/modules
// prefix — INV-O0-1), and its own migration (v13, claimed off the GLOBAL
// ledger in ../registry.ts — v12 was the last claimed slot, O2 research).
import { defineModule } from "../registry";
import { mountDocumentsRoutes } from "./router";
import { MIGRATION_V13_DOCUMENTS } from "./store";

export const documentsModule = defineModule({
  id: "documents",
  envFlag: "MODULE_DOCUMENTS",
  tab: { labelKey: "app.tab.documents", icon: "FileText" },
  mountRoutes: mountDocumentsRoutes,
  migrations: [MIGRATION_V13_DOCUMENTS],
});
