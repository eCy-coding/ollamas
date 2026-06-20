#!/usr/bin/env tsx
/**
 * orchestration/bin/critic.ts — Self-auditing completeness critic (vO10).
 *
 * READ-ONLY: orchestration sisteminin İÇ tutarlılığını deterministik denetler (roadmap-vs-gerçek
 * drift, orphan artefakt, test-coverage gap, duplicate araç) → CRITIC.md + CRITIC.json (conduct
 * COMPLETENESS beslemesi). Sistem kendi açığını bulur (self-improving). Lane denetlemez (§3).
 *
 * Çalıştır: tsx orchestration/bin/critic.ts [--strict]
 * Exit: high gap varsa --strict → 1.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { auditAll, scoreCompleteness, type Gap } from "./lib/critic";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const BIN = HERE;
const LIB = join(HERE, "lib");
const TESTS = join(ORCH_DIR, "tests");
const STRICT = process.argv.includes("--strict");

function read(p: string): string { try { return readFileSync(p, "utf8"); } catch { return ""; } }
function ls(dir: string, re: RegExp): string[] { try { return readdirSync(dir).filter((f) => re.test(f)); } catch { return []; } }

/** Bir .ts'in export edilen fonksiyon adları (regex). */
function exportsOf(path: string): string[] {
  const out: string[] = [];
  const re = /export\s+function\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  const src = read(path);
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** JSDoc ilk anlamlı satır → amaç (duplication için). */
function purposeOf(path: string): string {
  const head = read(path).split("\n").slice(0, 6);
  const line = head.find((l) => /—|--/.test(l) && /\*/.test(l));
  return line ? line.replace(/^\s*\*\s*/, "").replace(/^orchestration\/bin\/[\w.-]+\s*—\s*/, "").trim() : "";
}

function main(): void {
  // Araç + lib adları, artefaktlar, tüm kaynak metni, testler.
  const binFiles = ls(BIN, /\.ts$/).filter((f) => !/critic\.ts$/.test(f));
  const libFiles = ls(LIB, /\.ts$/).filter((f) => !/critic\.ts$/.test(f));
  const toolNames = [...binFiles, ...libFiles];
  const artifactNames = ls(ORCH_DIR, /\.(md|json)$/);

  const allSourceText = [
    ...binFiles.map((f) => read(join(BIN, f))),
    ...libFiles.map((f) => read(join(LIB, f))),
  ].join("\n");
  const testText = ls(TESTS, /\.test\.ts$/).map((f) => read(join(TESTS, f))).join("\n");

  // Coverage: yalnız lib/ pure modüller (CLI bin dosyaları main-only, entegrasyon-test'li → gürültü).
  const exportsByFile = libFiles.map((f) => ({ file: "lib/" + f, fns: exportsOf(join(LIB, f)) }))
    .filter((e) => e.fns.length);

  // Duplication: yalnız bin araçları (gerçek araçlar), ada göre dedup.
  const seen = new Set<string>();
  const tools = binFiles
    .filter((f) => !seen.has(f) && (seen.add(f), true))
    .map((f) => ({ name: f, purpose: purposeOf(join(BIN, f)) }))
    .filter((t) => t.purpose);

  const roadmapMd = read(join(ORCH_DIR, "ROADMAP_ORCHESTRATION.md"));

  const gaps: Gap[] = auditAll({ roadmapMd, toolNames, artifactNames, allSourceText, exportsByFile, testText, tools });
  const score = scoreCompleteness(gaps);

  const byKind = (k: string) => gaps.filter((g) => g.kind === k);
  const section = (title: string, k: string) => {
    const g = byKind(k);
    return [`### ${title} (${g.length})`, ...(g.length ? g.map((x) => `- **[${x.severity}]** ${x.target}: ${x.detail}\n  → ${x.action}`) : ["- _temiz_"]), ``];
  };

  const md = [
    `# CRITIC — Orchestration Öz-Denetim (completeness)`,
    ``,
    `> READ-ONLY \`critic.ts\` üretti. Sistem kendi açığını bulur (deterministik, self-improving).`,
    `> **Kapsamlılık skoru: ${score}/100** · ${gaps.length} gap (${binFiles.length} araç, ${artifactNames.length} artefakt).`,
    ``,
    ...section("🔴 Roadmap-vs-Gerçek Drift", "roadmap-drift"),
    ...section("DONE ama kanıt-yok", "done-no-evidence"),
    ...section("Orphan artefakt", "orphan-artifact"),
    ...section("Duplicate araç", "duplication"),
    ...section("Test-coverage gap", "coverage-gap"),
    `---`,
    `_Critic bulur+raporlar; fix conduct/insan (§3). CRITIC.json → conduct COMPLETENESS beslemesi._`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "CRITIC.md"), md + "\n");
  // conduct Finding-uyumlu besleme.
  writeFileSync(join(ORCH_DIR, "CRITIC.json"), JSON.stringify({
    ts: new Date().toISOString(), score,
    findings: gaps.map((g) => ({ tier: "COMPLETENESS", lane: "orchestration", kind: `crit:${g.kind}:${g.target}`, detail: g.detail, action: g.action, severity: g.severity === "high" ? 70 : g.severity === "med" ? 45 : 20 })),
  }, null, 2) + "\n");
  console.error(`[critic] skor ${score}/100, ${gaps.length} gap (drift ${byKind("roadmap-drift").length}, orphan ${byKind("orphan-artifact").length}, dup ${byKind("duplication").length}, cov ${byKind("coverage-gap").length}).`);

  if (STRICT && gaps.some((g) => g.severity === "high")) process.exit(1);
}

main();
