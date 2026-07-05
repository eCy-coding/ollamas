#!/usr/bin/env tsx
/**
 * orchestration/bin/refresh-catalog.ts — regenerate the task catalog (gen-catalog → build-tasks) in one step,
 * so the autopilot refresh loop keeps TASKS.json current as the source surface changes (iter-8 integration).
 *
 * Run:  tsx orchestration/bin/refresh-catalog.ts [--json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");

function run(script: string): void {
  execFileSync(TSX, [join(HERE, script)], { cwd: REPO, stdio: ["ignore", "ignore", "ignore"], timeout: 60_000 });
}

try {
  run("gen-catalog.ts");
  run("build-tasks.ts");
  const cat = JSON.parse(readFileSync(join(ORCH_DIR, "TASKS.json"), "utf8"));
  const out = { ok: true, count: cat.length };
  if (process.argv.includes("--json")) console.log(JSON.stringify(out));
  else console.log(`[refresh-catalog] TASKS.json = ${cat.length} tasks (fresh)`);
  console.error(`[refresh-catalog] ${cat.length} görev`);
} catch (e) {
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ok: false, error: (e as Error).message }));
  else console.error("[refresh-catalog] hata:", (e as Error).message);
  process.exit(1);
}
