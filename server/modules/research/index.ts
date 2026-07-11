// O2 research module (docs/odyssey/05-features/research.md) — deep_research
// pipeline (query-decompose → multi-search → fetch → rag-ingest → cited-synthesize)
// exposed as a ModuleDef. Mirrors server/modules/cookbook/index.ts: toggle
// (MODULE_RESEARCH, default OFF), a tab manifest, routes mounted under
// /api/modules/research (inherits localOwnerGuard via the single /api/modules
// prefix — INV-O0-1). Persistence: research_runs (v12, core migration ledger).
import { defineModule } from "../registry";
import { mountResearchRoutes } from "./router";
import { MIGRATION_V12_RESEARCH_RUNS } from "./store";

export const researchModule = defineModule({
  id: "research",
  envFlag: "MODULE_RESEARCH",
  tab: { labelKey: "app.tab.research", icon: "Compass" },
  mountRoutes: mountResearchRoutes,
  migrations: [MIGRATION_V12_RESEARCH_RUNS],
});
