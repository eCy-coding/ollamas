#!/usr/bin/env tsx
/**
 * orchestration/bin/refresh-catalog.ts — regenerate the task catalog (gen-catalog → build-tasks) in one step,
 * so the autopilot refresh loop keeps TASKS.json current as the source surface changes (iter-8 integration).
 *
 * Run:  tsx orchestration/bin/refresh-catalog.ts [--json]
 *
 * Pure output contract → ./lib/refresh-catalog-core (IO-free, unit-tested); this file is the spawn shell.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatRefresh } from "./lib/refresh-catalog-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const JSON_OUT = process.argv.includes("--json");

function run(script: string): void {
  execFileSync(TSX, [join(HERE, script)], { cwd: REPO, stdio: ["ignore", "ignore", "ignore"], timeout: 60_000 });
}

try {
  run("gen-catalog.ts");
  run("build-tasks.ts");
  const cat = JSON.parse(readFileSync(join(ORCH_DIR, "TASKS.json"), "utf8"));
  console.log(formatRefresh({ ok: true, count: cat.length }, JSON_OUT));
  console.error(`[refresh-catalog] ${cat.length} görev`);
} catch (e) {
  const line = formatRefresh({ ok: false, error: (e as Error).message }, JSON_OUT);
  if (JSON_OUT) console.log(line); else console.error(line);
  process.exit(1);
}
