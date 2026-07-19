// Code audit — "semantik bağı olmayan gereksizlerin" KOD tarafı: the import graph
// exposes orphan modules (nobody imports them) and exports no other file mentions.
// Report-only: nothing is deleted, findings land in the brain (conf 0.9) so future
// sessions inherit them. Usage: make brain-code-audit
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { buildImportGraph } from "./brain-teach-datasets";
import { brainRemember } from "../server/brain";

const ENTRY = /^(server\.ts|scripts\/|server\/modules\/|.*\.test\.ts$|.*\.d\.ts$)/;

export function findOrphans(files: [string, string][], importers: Map<string, Set<string>>): string[] {
  return files
    .map(([p]) => p)
    .filter((p) => !ENTRY.test(p) && !(importers.get(p)?.size))
    .sort();
}

/** Symbols exported but referenced nowhere ELSE. A hit may still be used inside its
 *  own file — then the finding means "the export keyword is unnecessary", not "dead
 *  code". Test-only users are separated so behavior-locked helpers stay visible. */
export function findUnusedExports(files: [string, string][]): { file: string; symbol: string; testOnly: boolean }[] {
  const out: { file: string; symbol: string; testOnly: boolean }[] = [];
  for (const [path, src] of files) {
    if (path.includes(".test.")) continue;
    const symbols = [...src.matchAll(/^export (?:async )?(?:function|const|class) ([\w$]+)/gm)].map((m) => m[1]);
    for (const sym of symbols) {
      const users = files.filter(([p, s]) => p !== path && new RegExp(`\\b${sym}\\b`).test(s));
      if (users.length === 0) out.push({ file: path, symbol: sym, testOnly: false });
      else if (users.every(([p]) => p.includes(".test."))) out.push({ file: path, symbol: sym, testOnly: true });
    }
  }
  return out;
}

async function main() {
  const files: [string, string][] = [];
  const push = (dir: string, filter: (n: string) => boolean) => {
    try { for (const n of readdirSync(dir)) if (filter(n)) files.push([`${dir}/${n}`, readFileSync(`${dir}/${n}`, "utf8")]); }
    catch { /* dir absent */ }
  };
  push("server", (n) => n.endsWith(".ts"));
  push("scripts", (n) => n.endsWith(".ts"));
  push("scripts/tests", (n) => n.endsWith(".ts"));
  push("tests", (n) => n.endsWith(".ts"));
  try { files.push(["server.ts", readFileSync("server.ts", "utf8")]); } catch { /* absent */ }
  const { importers } = buildImportGraph(files);
  const orphans = findOrphans(files, importers);
  const unused = findUnusedExports(files);
  const dead = unused.filter((u) => !u.testOnly);
  const testOnly = unused.filter((u) => u.testOnly);
  writeFileSync("docs/BRAIN-CODE-AUDIT.md",
    `# BRAIN-CODE-AUDIT — ölü-kod denetimi (${new Date().toISOString().slice(0, 16)})\n\n` +
    `Rapor-only (silme yok). Orphan = hiçbir modül import etmiyor (entry-point'ler hariç). ` +
    `"Yalnız-test" = sadece test dosyalarından kullanılıyor.\n\n` +
    `## Orphan modüller (${orphans.length})\n${orphans.map((o) => `- ${o}`).join("\n") || "- yok"}\n\n` +
    `## Dış-kullanımı olmayan export (${dead.length}) — dosya-içi kullanılıyor olabilir; bulgu "export gereksiz" demektir, "ölü kod" değil\n${dead.slice(0, 40).map((u) => `- ${u.file} → ${u.symbol}`).join("\n") || "- yok"}\n\n` +
    `## Yalnız-test export (${testOnly.length})\n${testOnly.slice(0, 30).map((u) => `- ${u.file} → ${u.symbol}`).join("\n") || "- yok"}\n`);
  try {
    await brainRemember({
      id: "code-audit:latest", tier: "learned", ns: "knowledge", actor: "code-audit", confidence: 0.9,
      source: "code-audit",
      content: `ollamas kod-denetimi: ${files.length} dosya tarandı — ${orphans.length} orphan modül (${orphans.slice(0, 5).join(", ") || "yok"}), ${dead.length} dış-kullanımı-olmayan export (export gereksiz olabilir), ${testOnly.length} yalnız-test export. Detay docs/BRAIN-CODE-AUDIT.md.`,
    });
  } catch { /* embedder queued → write-behind already handled it */ }
  console.log(JSON.stringify({ event: "brain.code.audit", files: files.length, orphans: orphans.length, unusedExports: dead.length, testOnly: testOnly.length }));
}
if (process.argv[1]?.includes("brain-code-audit")) void main();
