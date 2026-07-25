#!/usr/bin/env -S npx tsx
// vaultground (bin) — ground a query against REAL vault notes (dc-4.5). Reads a bounded slice of
// the vault (default: _help/**.md, the source-true corpus), runs the pure retrieval core, prints
// the citations. Offline, no :3000. Usage: `vaultground "<query>" [dir]`.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { groundQuery, renderGrounding, type Note } from "../lib/vaultground";

const HOME = homedir();
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");

function walk(dir: string, cap: number): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (out.length >= cap) break;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, cap - out.length));
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

function main() {
  const query = process.argv[2] ?? "";
  const sub = process.argv[3] ?? "_help";
  if (!query) { console.log('vaultground "<query>" [vault-subdir]'); process.exit(0); }
  const root = join(VAULT, sub);
  const notes: Note[] = walk(root, 400).map((p) => ({ path: p.replace(VAULT + "/", ""), text: readFileSync(p, "utf8") }));
  const g = groundQuery(query, notes, 5);
  console.log(`corpus: ${notes.length} not · ${renderGrounding(g)}`);
  for (const c of g.citations) console.log(`  · ${c.path} (${c.score})  ${c.snippet.slice(0, 90)}`);
  process.exit(g.grounded ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
