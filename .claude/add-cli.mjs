#!/usr/bin/env node
// add-cli — repeatable e2e CLI→harness integration.
//   node .claude/add-cli.mjs <cli> --tier allow|ask [--pattern "sub:*"] [--use "what for"]
// Steps: (1) smoke-test the CLI is installed + runnable, (2) append Bash(<cli> <pattern>) to
// cli-extensions.json (idempotent), (3) append a CLI-REGISTRY.md row, (4) print apply reminder.
// merge-settings.mjs unions cli-extensions into permissions; apply-harness makes it live.
// SAFE: edits structured JSON + the registry doc only — never regex-edits merge-settings.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const cli = args.find((a) => !a.startsWith("--"));
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const tier = opt("--tier", "allow");          // allow (read-only) | ask (side-effectful)
const pattern = opt("--pattern", ":*");        // Bash(<cli><pattern>) e.g. ":*" or " fs:*"
const use = opt("--use", "(unspecified)");
const DIR = new URL(".", import.meta.url).pathname;

const die = (m) => { console.error("✗ " + m); process.exit(1); };
if (!cli) die("usage: add-cli <cli> --tier allow|ask [--pattern \"sub:*\"] [--use \"purpose\"]");
if (!["allow", "ask"].includes(tier)) die(`--tier must be allow|ask (got ${tier})`);

// 1) smoke-test: installed?
let where = "";
try { where = execFileSync("command", ["-v", cli], { shell: "/bin/bash", encoding: "utf8" }).trim(); }
catch { die(`'${cli}' not installed. Install it first (brew install ${cli} / npm i -g ${cli}), then re-run.`); }
let ver = "";
for (const v of ["--version", "version", "-v"]) {
  try { ver = execFileSync(cli, [v], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0].trim(); break; } catch { /* try next */ }
}
console.error(`✓ smoke: ${cli} @ ${where}${ver ? ` (${ver})` : ""}`);

// 2) append to cli-extensions.json (idempotent)
const rule = `Bash(${cli}${pattern})`;
const extPath = DIR + "cli-extensions.json";
const ext = JSON.parse(readFileSync(extPath, "utf8"));
ext[tier] = ext[tier] || [];
if (ext.allow?.includes(rule) || ext.ask?.includes(rule)) {
  console.error(`= already integrated: ${rule}`);
} else {
  ext[tier].push(rule);
  writeFileSync(extPath, JSON.stringify(ext, null, 2) + "\n");
  console.error(`✓ added to cli-extensions.json [${tier}]: ${rule}`);
  // 3) registry row
  const reg = DIR + "CLI-REGISTRY.md";
  if (existsSync(reg)) appendFileSync(reg, `\n<!-- added ${new Date().toISOString().slice(0,10)} --> | ${cli} | ${tier} | ${use} | ${rule} |`);
}

// 4) apply reminder
console.error(`\nNEXT (operator):\n  bash .claude/apply-harness.sh   # union → live\n  # restart tab if it's also an MCP/slash addition`);
process.exit(0);
