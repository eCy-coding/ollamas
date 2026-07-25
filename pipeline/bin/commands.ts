#!/usr/bin/env -S npx tsx
// commands — generate a source-derived terminal-command reference (8.7). Reads the REAL command
// surfaces on disk and emits pipeline/COMMANDS.md; nothing is hand-listed, so it stays fresh.
//
//   pipeline subcommands  ← pipeline/bin/*.ts (name + header-comment description)
//   eCym commands         ← ~/.local/bin/ecy* (executables, minus backups/aliases)
//   obsidian KB tools     ← ~/ollamas-vault/_bin/cc* + cckb
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");
const LOCALBIN = join(HOME, ".local", "bin");

/** One-line description from a bin file's header comment (`// name — desc`). */
function desc(file: string): string {
  try {
    const lines = readFileSync(file, "utf8").split("\n").slice(0, 8);
    const c = lines.find((l) => /^(#|\/\/)\s*\S+\s+[—-]\s+/.test(l));
    if (c) return c.replace(/^(#|\/\/)\s*\S+\s+[—-]\s+/, "").trim().replace(/\|/g, "\\|");
    const any = lines.find((l) => (l.startsWith("//") || l.startsWith("#")) && !l.includes("env ") && !l.includes("!/"));
    return any ? any.replace(/^(#|\/\/)\s*/, "").trim().replace(/\|/g, "\\|") : "—";
  } catch {
    return "—";
  }
}

function pipelineRows(): string[][] {
  const dir = join(REPO, "pipeline", "bin");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()
    .map((f) => [`ollamas pipeline ${f.replace(/\.ts$/, "")}`, desc(join(dir, f)), `pipeline/bin/${f}`]);
}

/** eCym executables (skip .bak, symlinks-to-elsewhere handled as names). */
function ecyRows(): string[][] {
  if (!existsSync(LOCALBIN)) return [];
  return readdirSync(LOCALBIN)
    .filter((f) => /^ecy/.test(f) && !f.includes(".bak") && !f.endsWith(".command"))
    .sort()
    .map((f) => {
      const p = join(LOCALBIN, f);
      let d = "—";
      try { if (!lstatSync(p).isSymbolicLink()) d = desc(p); } catch { /* skip */ }
      return [`\`${f}\``, d, `~/.local/bin/${f}`];
    });
}

function ccRows(): string[][] {
  const dir = join(VAULT, "_bin");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => (/^cc/.test(f) || f === "cckb") && !f.endsWith(".pyc") && !f.includes("__pycache__"))
    .sort()
    .map((f) => [`\`${f}\``, desc(join(dir, f)), `_bin/${f}`]);
}

function table(headers: string[], rows: string[][]): string {
  const L = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) L.push(`| ${r.join(" | ")} |`);
  return L.join("\n");
}

function render(): string {
  const pl = pipelineRows(), ecy = ecyRows(), cc = ccRows();
  return [
    "# Terminal Commands — eCym · ollamas · obsidian",
    "",
    "> Source-derived (regenerate: `npx tsx pipeline/bin/commands.ts`). Every row is a real file on disk.",
    "",
    `## ollamas — \`pipeline\` subcommands (${pl.length})`,
    "",
    table(["Command", "What it does", "Source"], pl),
    "",
    `## eCym — local commands (${ecy.length})`,
    "",
    "Run visibly in Terminal.app; `$0` local. Env: `ECY_YES` (approve risky), `ECY_MAX` (loop cap), `ECYM_NO_TRACKER`, `ECY_DATASET`.",
    "",
    table(["Command", "What it does", "Source"], ecy),
    "",
    `## obsidian — knowledge-base tools (${cc.length})`,
    "",
    table(["Command", "What it does", "Source"], cc),
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(REPO, "pipeline", "COMMANDS.md");
  const verifyOnly = process.argv.includes("--verify");
  const md = render();
  if (verifyOnly) {
    const n = (md.match(/\|/g) || []).length;
    console.log(`commands: ${md.split("\n").filter((l) => l.startsWith("| `") || l.startsWith("| ollamas")).length} komut satırı`);
    process.exit(n > 0 ? 0 : 1);
  }
  writeFileSync(out, md, "utf8");
  console.log(`yazıldı: pipeline/COMMANDS.md (${md.split("\n").length} satır)`);
}

export { pipelineRows, ecyRows, ccRows };
