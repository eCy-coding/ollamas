#!/usr/bin/env node
// TDD scaffold generator (scripts lane, v13) — bootstraps the next version's
// skeleton with zero manual file creation: a RED vitest test + a pure lib stub,
// matching the lane convention (lib/*.mjs + tests/*.test.ts). Dev-time generator,
// NOT a host-callable tool (stays out of inventory.json → drift unchanged).
//
// Adopts the plopjs/plop · hygen (MIT) "plan → files-to-write" pattern, pure JS.
//   node scaffold.mjs <feature> [--tool]          # dry: print the plan
//   node scaffold.mjs <feature> [--tool] --write  # write (never overwrites)
//   node scaffold.mjs --from-roadmap              # suggest a slug from ROADMAP
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.OLLAMAS_REPO || join(HERE, "..", "..");

// Slug guard: lowercase start, [a-z0-9_-], no slash/dot → blocks path traversal.
export function validSlug(s) {
  return typeof s === "string" && /^[a-z][a-z0-9_-]*$/.test(s);
}

// Pure: the files to write for a feature. `tool` adds the 4-point registration note.
export function scaffoldPlan(feature, { tool = false } = {}) {
  if (!validSlug(feature)) throw new Error(`invalid feature slug: ${JSON.stringify(feature)} (want ^[a-z][a-z0-9_-]*$)`);
  const testStub = `// Scripts domain — ${feature} (scaffolded, v13). TDD: write the failing
// assertions first, then implement bin/host-bridge/lib/${feature}.mjs to green.
import { describe, test, expect } from "vitest";
import { ${camel(feature)} } from "../../bin/host-bridge/lib/${feature}.mjs";

describe("${feature}", () => {
  test("TODO: first failing assertion", () => {
    expect(${camel(feature)}).toBeTypeOf("function");
  });
});
`;
  const libStub = `// ${feature} (scripts lane, scaffolded v13) — PURE, no fs/network.
// WHY: <one line, non-obvious reason this exists>. Implement to make
// scripts/tests/${feature}.test.ts pass, then wire via the choke-point if it is a tool.
export function ${camel(feature)}() {
  throw new Error("not implemented: ${feature}");
}
`;
  const plan = [
    { path: `scripts/tests/${feature}.test.ts`, content: testStub },
    { path: `bin/host-bridge/lib/${feature}.mjs`, content: libStub },
  ];
  if (tool) {
    plan.push({
      path: `__REGISTER_CHECKLIST__`,
      content: `4-point registration (drift-check enforces): 1) scripts/inventory.json entry {name:"${feature}",tier,entry:"${feature}.mjs"} 2) bin/host-bridge/schema.mjs SCHEMAS.${feature} 3) register-host-scripts.mjs BUILDERS.${feature} 4) bin/host-bridge/tools/${feature}.mjs`,
    });
  }
  return plan;
}

// Best-effort: pull a suggested slug from the ROADMAP "ilk hamle = ...lib/<slug>" hint.
export function roadmapNextSlug(text) {
  const m = String(text || "").match(/lib\/([a-z][a-z0-9_-]*)\.mjs/);
  return m ? m[1] : null;
}

function camel(slug) {
  return slug.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const tool = args.includes("--tool");
  if (args.includes("--from-roadmap")) {
    const rd = join(REPO, "scripts", "ROADMAP_SCRIPTS.md");
    const slug = existsSync(rd) ? roadmapNextSlug(readFileSync(rd, "utf8")) : null;
    console.log(slug ? `suggested slug: ${slug}` : "no lib/<slug>.mjs hint in ROADMAP next-precomputed");
    process.exit(0);
  }
  const feature = args.find((a) => !a.startsWith("--"));
  if (!feature) { console.error("usage: scaffold.mjs <feature> [--tool] [--write]"); process.exit(2); }
  let plan;
  try { plan = scaffoldPlan(feature, { tool }); } catch (e) { console.error(`[!] ${e.message}`); process.exit(1); }
  for (const f of plan) {
    if (f.path === "__REGISTER_CHECKLIST__") { console.log("\n" + f.content + "\n"); continue; }
    const abs = join(REPO, f.path);
    if (!write) { console.log(`[dry] would write ${f.path} (${f.content.split("\n").length} lines)`); continue; }
    if (existsSync(abs)) { console.error(`[!] refuse: ${f.path} exists (no overwrite)`); process.exit(1); }
    writeFileSync(abs, f.content);
    console.log(`[+] wrote ${f.path}`);
  }
  if (!write) console.log("(dry run — pass --write to create files; existing files are never overwritten)");
}
