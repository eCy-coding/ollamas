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

// F2 — never auto-grant a destructive command. F4 — side-effect-named CLIs must be 'ask', not 'allow'.
const DESTRUCTIVE = /\b(rm|rmdir|dd|mkfs|shred|fdisk|format)\b/i;
const SIDE_EFFECT = /(deploy|push|publish|delete|destroy|drop|prune|rm|del)/i;
if (DESTRUCTIVE.test(cli)) die(`'${cli}' is destructive — refused. Run it manually if truly intended (not harness-allowed).`);
if (tier === "allow" && SIDE_EFFECT.test(cli)) die(`'${cli}' looks side-effectful — use --tier ask (not allow). Re-run with --tier ask.`);

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
// F2 — refuse if the rule collides with a known base deny pattern.
const BASE_DENY = ["Bash(rm -rf:*)", "Bash(git push --force:*)"];
if (BASE_DENY.includes(rule)) die(`rule ${rule} collides with a base deny — refused.`);
const extPath = DIR + "cli-extensions.json";
const ext = JSON.parse(readFileSync(extPath, "utf8"));
ext[tier] = ext[tier] || [];
if (ext.allow?.includes(rule) || ext.ask?.includes(rule)) {
  console.error(`= already integrated: ${rule}`);
} else {
  ext[tier].push(rule);
  writeFileSync(extPath, JSON.stringify(ext, null, 2) + "\n");
  console.error(`✓ added to cli-extensions.json [${tier}]: ${rule}`);
  // 3) registry row — ensure a proper "## Eklenenler" table block exists, append under it.
  const reg = DIR + "CLI-REGISTRY.md";
  if (existsSync(reg)) {
    let body = readFileSync(reg, "utf8");
    const HEADER = "\n## Eklenenler (add-cli)\n| eklendi | CLI | tier | kullanım | rule |\n|---|---|---|---|---|\n";
    if (!body.includes("## Eklenenler (add-cli)")) { body += "\n" + HEADER; }
    body += `| ${new Date().toISOString().slice(0, 10)} | ${cli} | ${tier} | ${use} | \`${rule}\` |\n`;
    writeFileSync(reg, body);
  }
}

// 4) apply reminder
console.error(`\nNEXT (operator):\n  bash .claude/apply-harness.sh   # union → live\n  # restart tab if it's also an MCP/slash addition`);
process.exit(0);
