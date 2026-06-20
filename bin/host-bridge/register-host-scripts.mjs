// Manifest-driven host tool registration (scripts lane, v5).
//
// THE register-seam. Reads scripts/inventory.json (single source of truth),
// validates each tool's args via zod, derives the JSON-schema the registry needs,
// and reconciles the manifest into the choke-point (server/tool-registry.ts).
//
// Idempotent reconciler: a tool already present (the static built-in set) is
// SKIPPED, so wiring this at boot never duplicates tools nor pollutes the MCP
// expose / ReAct surface. On a registry that does NOT yet hold a tool, it is
// registered from the manifest with its zod-derived schema — the migration path
// for v6 (static defs -> manifest). Adopts the modelcontextprotocol/typescript-sdk
// registerTool contract (MIT/Apache) + colinhacks/zod (MIT).
//
// Scope: tools reach the host ONLY through `deps.execOnHost` -> the bridge
// (HTTP choke-point). This file never spawns a process itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMAS, toJsonSchema, validateArgs } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// repo root is two levels up from bin/host-bridge/
const DEFAULT_INVENTORY = join(HERE, "..", "..", "scripts", "inventory.json");

// argv builders mirror server/tool-registry.ts. Each gets the validated args +
// deps (for shArg shell-quoting) and returns { argv, timeoutMs?, stdin? }.
const BUILDERS = {
  run_tests: () => ({ argv: "" }),
  git_ops: (a, d) => ({ argv: d.shArg(String(a.sub || "status")) }),
  process_port: (a) => ({ argv: String(Number(a.port) || 3000) }),
  health_probe: () => ({ argv: "" }),
  lint_format: () => ({ argv: "", timeoutMs: 250000 }),
  git_commit: (a, d) => ({ argv: `${a.push ? "--push " : ""}${d.shArg(String(a.message))}` }),
  build_app: () => ({ argv: "", timeoutMs: 220000 }),
  kill_process: (a, d) => ({ argv: `${a.signal ? "--sig " + d.shArg(String(a.signal)) + " " : ""}${d.shArg(String(a.target))}` }),
  log_stream: (a) => ({ argv: String(Number(a.lines) || 40) }),
  pkg_install: (a, d) => ({ argv: `${d.shArg(String(a.manager))} ${d.shArg(String(a.package))}`, timeoutMs: 150000 }),
  web_search: (a, d) => (a.url ? { argv: `--fetch ${d.shArg(String(a.url))}` } : { argv: d.shArg(String(a.query || "")) }),
  apply_patch: (a, d) => ({ argv: "", stdin: d.shArg(String(a.diff)) }),
  tools_doctor: () => ({ argv: "", timeoutMs: 90000 }),
  shell_check: (a, d) => ({ argv: d.shArg(String(a.command)), timeoutMs: 60000 }),
  logbook: (a, d) => (a.action === "add"
    ? { argv: `add ${d.shArg(String(a.text || ""))}` }
    : { argv: `tail ${Number(a.n) || 20}` }),
  self_heal: (a) => ({ argv: a.apply ? "--apply" : "", timeoutMs: 90000 }),
  seyir_stats: (a) => ({ argv: [a.json ? "--json" : "", a.window ? `--window ${Number(a.window)}` : "", a.slo ? `--slo ${Number(a.slo)}` : ""].filter(Boolean).join(" ") }),
  usage: (a, d) => ({ argv: [a.json ? "--json" : "", a.month ? `--month ${d.shArg(String(a.month))}` : "", a.rate != null ? `--rate ${Number(a.rate)}` : "", a.budget != null ? `--budget ${Number(a.budget)}` : ""].filter(Boolean).join(" ") }),
  model_select: (a, d) => ({ argv: [a.json ? "--json" : "", a.metric ? `--metric ${d.shArg(String(a.metric))}` : "", a.minTps != null ? `--min-tps ${Number(a.minTps)}` : ""].filter(Boolean).join(" ") }),
};

export function loadInventory(inventoryPath = DEFAULT_INVENTORY) {
  const raw = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const tools = Array.isArray(raw.tools) ? raw.tools : [];
  for (const t of tools) {
    if (!t.name || !t.tier || !t.entry) throw new Error(`inventory: tool missing name/tier/entry: ${JSON.stringify(t)}`);
    if (!SCHEMAS[t.name]) throw new Error(`inventory: no schema.mjs entry for '${t.name}'`);
    if (!BUILDERS[t.name]) throw new Error(`inventory: no argv builder for '${t.name}'`);
  }
  return { tools };
}

// Build the { tier, schema, invoke } registry def for one inventory entry.
// schema is the OpenAI function-call shape the registry/expose expect
// (server/tool-registry.ts ToolSchema): { type:"function", function:{...} }.
export function buildToolDef(entry, deps) {
  const schema = {
    type: "function",
    function: {
      name: entry.name,
      description: entry.description || `${entry.name} (host tool)`,
      parameters: toJsonSchema(SCHEMAS[entry.name]),
    },
  };
  const build = BUILDERS[entry.name];
  const invoke = async (rawArgs) => {
    const args = validateArgs(entry.name, rawArgs); // zod — throws -> choke-point shapes the error
    const { argv, timeoutMs, stdin } = build(args, deps);
    const bin = `node ${deps.HOST_TOOLS_DIR}/${entry.entry}`;
    const cmd = stdin
      ? `printf '%s' ${stdin} | ${bin}${argv ? " " + argv : ""}`
      : `${bin}${argv ? " " + argv : ""}`;
    return timeoutMs ? deps.execOnHost(cmd, timeoutMs) : deps.execOnHost(cmd);
  };
  return { name: entry.name, def: { tier: entry.tier, schema, invoke } };
}

// THE seam. Reconcile the manifest into the registry: register tools that are
// absent, skip those already present (static built-ins). Idempotent — safe to
// re-run. Returns { registered, skipped, names, skipped_names } for the boot log.
export function registerHostScripts(registry, deps, inventoryPath = DEFAULT_INVENTORY) {
  const { tools } = loadInventory(inventoryPath);
  const names = [];
  const skipped = [];
  for (const entry of tools) {
    if (registry.has(entry.name)) { skipped.push(entry.name); continue; }
    const { name, def } = buildToolDef(entry, deps);
    registry.register(name, def);
    names.push(name);
  }
  return { registered: names.length, skipped: skipped.length, names, skipped_names: skipped };
}

export { DEFAULT_INVENTORY, BUILDERS };
