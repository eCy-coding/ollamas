#!/usr/bin/env node
// Standalone drift guard (scripts lane, v10 GA). The host-tool registration has
// FOUR sources that must name the exact same set of tools:
//   1. scripts/inventory.json   — the manifest (single source of truth)
//   2. schema.mjs SCHEMAS keys  — zod arg validation
//   3. bin/host-bridge/tools/*.mjs — the executables
//   4. register-host-scripts.mjs BUILDERS keys — argv builders
// register-host-scripts.mjs throws on SOME of these AT BOOT, but only in the
// inventory→{schema,builder} direction and only when the server starts. This is
// the static, boot-free, bidirectional check CI runs: it also catches ORPHANS
// (a schema/tool/builder with no manifest entry) and missing entry files.
//
// Pure set algebra: for each pair, the symmetric difference must be empty.
// Exit 0 = aligned, exit 1 = drift (prints the offending names). Zero deps.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMAS } from "./schema.mjs";
import { BUILDERS, DEFAULT_INVENTORY } from "./register-host-scripts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(HERE, "tools");

/** Names present in A but not in B (one direction of the symmetric difference). */
function minus(a, b) {
  const setB = new Set(b);
  return [...a].filter((x) => !setB.has(x)).sort();
}

export function collectSources(inventoryPath = DEFAULT_INVENTORY, toolsDir = TOOLS_DIR) {
  const inv = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const tools = Array.isArray(inv.tools) ? inv.tools : [];
  return {
    inventory: tools.map((t) => t.name),
    entries: tools.map((t) => t.entry),
    schema: Object.keys(SCHEMAS),
    builders: Object.keys(BUILDERS),
    // top-level *.mjs only (tools/lib/ helpers are not tools)
    files: readdirSync(toolsDir).filter((f) => f.endsWith(".mjs")).map((f) => f.replace(/\.mjs$/, "")),
    toolsDir,
    inventoryEntries: tools.map((t) => ({ name: t.name, entry: t.entry })),
  };
}

/** Returns { ok, drifts:[{pair, onlyInA, onlyInB}], missingFiles:[] }. Pure. */
export function detectDrift(src) {
  const drifts = [];
  const pair = (name, a, b, an, bn) => {
    const onlyInA = minus(a, b);
    const onlyInB = minus(b, a);
    if (onlyInA.length || onlyInB.length) drifts.push({ pair: name, [`only_in_${an}`]: onlyInA, [`only_in_${bn}`]: onlyInB });
  };
  pair("inventory↔schema", src.inventory, src.schema, "inventory", "schema");
  pair("inventory↔builders", src.inventory, src.builders, "inventory", "builders");
  pair("inventory↔files", src.inventory, src.files, "inventory", "files");
  // every manifest entry file must exist on disk
  const missingFiles = src.inventoryEntries
    .filter((e) => !existsSync(join(src.toolsDir, e.entry)))
    .map((e) => `${e.name} -> ${e.entry}`);
  return { ok: drifts.length === 0 && missingFiles.length === 0, drifts, missingFiles };
}

// CLI: print a report, exit non-zero on drift (CI gate).
if (import.meta.url === `file://${process.argv[1]}`) {
  const src = collectSources();
  const res = detectDrift(src);
  if (res.ok) {
    console.log(`drift-check: OK — ${src.inventory.length} tools aligned across inventory/schema/builders/files`);
    process.exit(0);
  }
  console.error("drift-check: DRIFT DETECTED");
  for (const d of res.drifts) console.error("  " + JSON.stringify(d));
  if (res.missingFiles.length) console.error("  missing entry files: " + JSON.stringify(res.missingFiles));
  process.exit(1);
}
