// v1.29.4 µ3 — DOCS-GAPS audit generator. Diffs the routes REGISTERED in server.ts
// (parsed by scripts/route-usage.ts) against the paths DOCUMENTED in server/openapi.ts
// (openApiSpec.paths), and writes docs/audit/DOCS-GAPS.md — a table of undocumented routes.
//
// Run: npx tsx scripts/gen-docs-gaps.ts   (writes the file, prints the undocumented count)
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseServerRoutes, buildConstantMap, normalizePath } from "./route-usage";
import { openApiSpec } from "../server/openapi";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== "node_modules") out.push(...walk(p, exts)); }
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

// OpenAPI path template ({id}) → same normal form the route parser emits (:id → *).
function normOpenApi(p: string): string {
  return normalizePath(p.replace(/\{[^}]+\}/g, "*"));
}

const serverSrc = readFileSync(join(ROOT, "server.ts"), "utf8");
const constants = buildConstantMap(walk(join(ROOT, "server"), [".ts"]).map((f) => readFileSync(f, "utf8")));
const routes = parseServerRoutes(serverSrc, constants);

// Documented surface: {method \0 normalizedPath} present in the served OpenAPI spec.
const spec = openApiSpec as { paths?: Record<string, Record<string, unknown>> };
const documented = new Set<string>();
const documentedPaths = new Set<string>();
for (const [p, ops] of Object.entries(spec.paths || {})) {
  const np = normOpenApi(p);
  documentedPaths.add(np);
  for (const m of Object.keys(ops || {})) documented.add(`${m.toUpperCase()}\0${np}`);
}

// Undocumented = a concrete server route (not a router mount) whose method+path is absent
// from the OpenAPI spec. Mounts (app.use prefixes) delegate to sub-routers documented (or not)
// under their own paths, so they are reported separately as an informational note, not gaps.
type Row = { method: string; path: string; normalized: string };
const seen = new Set<string>();
const gaps: Row[] = [];
for (const r of routes) {
  if (r.isMount) continue;
  if (!r.path.startsWith("/")) continue;
  const key = `${r.method}\0${r.normalized}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (!documented.has(key)) gaps.push({ method: r.method, path: r.path, normalized: r.normalized });
}
gaps.sort((a, b) => a.normalized.localeCompare(b.normalized) || a.method.localeCompare(b.method));

const mounts = Array.from(new Set(routes.filter((r) => r.isMount && r.path.startsWith("/")).map((r) => r.path))).sort();

const now = new Date().toISOString().slice(0, 10);
const lines: string[] = [];
lines.push("# DOCS-GAPS — undocumented HTTP routes audit");
lines.push("");
lines.push(`> Generated ${now} by \`scripts/gen-docs-gaps.ts\` (v1.29.4 µ3). Source of truth:`);
lines.push("> route registrations parsed from `server.ts` (via `scripts/route-usage.ts`) diffed against");
lines.push("> the served OpenAPI spec `server/openapi.ts` (`openApiSpec.paths`). Regenerate after route changes.");
lines.push("");
lines.push(`**Undocumented routes: ${gaps.length}** — concrete \`server.ts\` handlers absent from the OpenAPI spec.`);
lines.push("");
lines.push("Many are intentionally internal (health, telemetry, cockpit SSE, admin, host bridges) — this table");
lines.push("is an inventory of the doc surface gap, not a mandate to document every internal endpoint.");
lines.push("");
lines.push("| # | Method | Route (as registered) | Normalized |");
lines.push("| --- | --- | --- | --- |");
gaps.forEach((g, i) => {
  lines.push(`| ${i + 1} | ${g.method} | \`${g.path}\` | \`${g.normalized}\` |`);
});
lines.push("");
lines.push(`Router mounts (\`app.use(prefix, …)\`) delegate to sub-routers documented under their own paths — informational, not counted above: ${mounts.length ? mounts.map((m) => "`" + m + "`").join(", ") : "none"}.`);
lines.push("");

writeFileSync(join(ROOT, "docs/audit/DOCS-GAPS.md"), lines.join("\n"));
console.log(`DOCS-GAPS.md written — ${gaps.length} undocumented routes, ${documentedPaths.size} documented paths, ${mounts.length} mounts.`);
