#!/usr/bin/env node
// PostToolUse hook (matcher Edit|Write) — fast, best-effort format of the file just touched.
// ROOT FIX: single formatter pass, LOCAL binaries only (no `npx -y` network auto-install),
// short timeout → no multi-second blocking on every edit. NON-BLOCKING: always exit 0.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const f = p.tool_input?.file_path || p.tool_input?.path;
  if (!f || !/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(f) || !existsSync(f)) process.exit(0);

  const run = (bin, args) => { try { execFileSync(bin, args, { stdio: "ignore", timeout: 8000 }); return true; } catch { return false; } };
  const localBin = (name) => { const b = `node_modules/.bin/${name}`; return existsSync(b) ? b : null; };

  let scripts = {};
  try { scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts || {}; } catch { /* none */ }

  // Single pass, in priority order. Local binaries only — never auto-install.
  let done = false;
  const eslint = localBin("eslint");
  const prettier = localBin("prettier");
  if (scripts.format) done = run("npm", ["run", "-s", "format", "--", f]);
  if (!done && eslint && (existsSync(".eslintrc") || existsSync(".eslintrc.json") || existsSync("eslint.config.js")))
    done = run(eslint, ["--fix", f]);
  if (!done && prettier && (existsSync(".prettierrc") || existsSync(".prettierrc.json") || existsSync("prettier.config.js")))
    done = run(prettier, ["--write", f]);

  if (done) process.stderr.write(`formatted: ${f}\n`);
  process.exit(0);
});
