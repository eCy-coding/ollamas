#!/usr/bin/env -S npx tsx
// htmllint (bin) — run the zero-dep a11y/perf linter over every emitted web/help/**.html (9.7).
// Offline, no browser. Exits 1 if any page has an a11y error.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lintHtml, isClean, renderReport } from "../lib/htmllint";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const ROOT = arg ? (arg.startsWith("/") ? arg : join(REPO, arg)) : join(REPO, "web", "help");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let bad = 0, total = 0;
for (const f of files) {
  const issues = lintHtml(readFileSync(f, "utf8"));
  total += issues.filter((i) => i.level === "error").length;
  for (const l of renderReport(f.replace(ROOT + "/", ""), issues)) console.log(l);
  if (!isClean(issues)) bad++;
}
console.log(bad === 0 ? `htmllint: PASS — ${files.length} sayfa, 0 a11y hata` : `htmllint: FAIL — ${bad}/${files.length} sayfa, ${total} hata`);
process.exit(bad === 0 ? 0 : 1);
