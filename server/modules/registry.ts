// O0 module registry (ODYSSEY 02-o0-foundation.md §2.4) — the single
// registration path for every optional module: routes, tools, tab manifest,
// migrations, env toggle.
//
// INV-O0-1 (V7 lesson, §2.3): every module route registered on Express MUST
// live under the single `/api/modules` prefix, which is covered ONCE by the
// localOwnerGuard prefix-allowlist (server.ts). A module physically cannot
// escape: mountRoutes() receives a scoped Router mounted at
// /api/modules/<id>, never the raw app. Modules declaring authPolicy:"tenant"
// instead pass through the authMiddleware chain.
//
// MIGRATION VERSION LEDGER (global-monotonic, §2.5 — source of truth is THIS
// comment; a new module claims the next free number here in the same PR):
//   v1–v6  core (server/store/migrations.ts — shipped)
//   v7     O0 (this plan): modules_registry + module_demo_items
//   v8–v9  O5 notes/tasks: notes, tasks, cron tables
//   v10    O6 calendar: events/reminders
//   v11    O4 email: module_email_messages (IMAP/SMTP triage cache)
//   v12    O2 research: research_runs
//   v13    O3 documents: module_documents
//   v14    O8 settings: totp/backup-codes/roles/tool-policy/prefs/sessions (module_settings_*)
//   v15+   free pool — claim sequentially from this ledger
// Module migrations are appended to the CORE ledger via allModuleMigrations();
// assertUniqueVersions runs on the COMBINED list (KN-A7 mitigation).
import express from "express";
import type { Migration } from "../store/migrations";
import { ToolRegistry, type ToolTier, type ToolSchema } from "../tool-registry";
import { authMiddleware } from "../middleware/auth";

// Mirror of the frontend capability union (src/lib/capabilities.ts). Declared
// locally so server code never imports from src/ (boundary rule).
export type Capability = "fileRead" | "fileWrite" | "commandExec" | "git";

export interface ModuleTool {
  name: string;
  tier: ToolTier;
  schema: ToolSchema;
  invoke: (args: any, ctx: any) => Promise<any>;
}

export interface ModuleDef {
  /** ^[a-z][a-z0-9-]*$ — becomes the /api/modules/<id> prefix + tab id. */
  id: string;
  /** Env toggle, e.g. "MODULE_DEMO". Default OFF: only the literal "1" enables. */
  envFlag: string;
  /** Frontend tab manifest (GET /api/modules). Absent → headless module. */
  tab?: { labelKey: string; icon: string; requiresCap?: Capability };
  /** default "local-owner" (INV-O0-1); "tenant" routes through authMiddleware. */
  authPolicy?: "local-owner" | "tenant";
  /** Registry mounts the router at /api/modules/<id> — modules never see `app`. */
  mountRoutes(router: express.Router): void;
  /** Registered into ToolRegistry ONLY while the module is enabled. */
  tools?: ModuleTool[];
  /** Versions are GLOBAL-monotonic (ledger above), never module-local. */
  migrations?: Migration[];
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const MODULES = new Map<string, ModuleDef>();
// Apps that already carry the GET /api/modules listing route — a second
// mountEnabledModules() call (tests mount extra fake modules onto the real
// app) must not stack a duplicate handler.
const LISTED_APPS = new WeakSet<express.Express>();

/** Register a module definition. Throws on invalid or duplicate id. */
export function defineModule(def: ModuleDef): ModuleDef {
  if (!ID_RE.test(def.id)) {
    throw new Error(`invalid module id '${def.id}' (must match ${ID_RE})`);
  }
  if (MODULES.has(def.id)) {
    throw new Error(`module id '${def.id}' already registered`);
  }
  MODULES.set(def.id, def);
  return def;
}

/** Default-OFF toggle (KN-A5): only envFlag === "1" enables; unknown id → false. */
export function moduleEnabled(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const def = MODULES.get(id);
  if (!def) return false;
  return env[def.envFlag] === "1";
}

/** Enabled modules + their tab manifests — the GET /api/modules payload and the
 *  frontend's single tab registration path. Reads env at CALL time (the route
 *  mount itself is boot-time — KN-O2: toggling requires a restart). */
export function enabledModules(env: NodeJS.ProcessEnv = process.env): { id: string; tab?: ModuleDef["tab"] }[] {
  return [...MODULES.values()]
    .filter((d) => env[d.envFlag] === "1")
    .map((d) => ({ id: d.id, ...(d.tab ? { tab: d.tab } : {}) }));
}

/** Combined module migration ledger — appended to the core MIGRATIONS at boot;
 *  assertUniqueVersions runs on the merged list (KN-A7). */
export function allModuleMigrations(): Migration[] {
  return [...MODULES.values()].flatMap((d) => d.migrations ?? []);
}

/** Mount every enabled module under /api/modules/<id> and register its tools.
 *  Boot-time env read (KN-O2). Each created Router is stamped with __moduleId
 *  so the INV-O0-1 structural test can prove no module layer lives outside the
 *  /api/modules prefix. */
export function mountEnabledModules(app: express.Express, env: NodeJS.ProcessEnv = process.env): void {
  for (const def of MODULES.values()) {
    if (env[def.envFlag] !== "1") continue;
    const router = express.Router();
    (router as any).__moduleId = def.id;
    def.mountRoutes(router);
    const prefix = `/api/modules/${def.id}`;
    if (def.authPolicy === "tenant") {
      app.use(prefix, authMiddleware(true), router);
    } else {
      app.use(prefix, router);
    }
    for (const t of def.tools ?? []) {
      ToolRegistry.register(t.name, { tier: t.tier, schema: t.schema, invoke: t.invoke });
    }
  }
  if (!LISTED_APPS.has(app)) {
    LISTED_APPS.add(app);
    // Listing route lives under the same guarded prefix → localOwnerGuard
    // covers it automatically (SaaS mode: 403 → frontend deny-by-default).
    app.get("/api/modules", (_req, res) => {
      res.json({ modules: enabledModules() });
    });
  }
}

/** Test-only: clear the registry between cases (module map is process-global). */
export function _resetModulesForTest(): void {
  MODULES.clear();
}
