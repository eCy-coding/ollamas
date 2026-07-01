#!/usr/bin/env tsx
/**
 * orchestration/bin/think.ts — the THINK loop CLI (sustainable problem-solving mechanism).
 *
 * Reads the live findings already produced by the self-audit tools (CRITIC.json, DOD.json,
 * REQUIREMENTS.json, FLEET_STATUS) → for each, looks up a PROVEN, cited solution in
 * PROBLEM_REGISTRY.json → writes THINK.md. Unknown problems are flagged NEEDS_RESEARCH; the
 * mechanism NEVER invents a fix (only cited, verified solutions). The registry is append-only, so
 * every newly researched+verified fix makes the mechanism smarter next time.
 *
 * Run:  tsx orchestration/bin/think.ts [--json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { thinkAll, renderThink, type RegistryEntry, type Finding } from "./lib/think";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const JSON_OUT = process.argv.includes("--json");

function readJson(name: string): any { const f = join(ORCH_DIR, name); if (!existsSync(f)) return null; try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }

function loadRegistry(): RegistryEntry[] {
  const r = readJson("PROBLEM_REGISTRY.json");
  return Array.isArray(r?.entries) ? r.entries : [];
}

/** Gather live findings from the self-audit artifacts (no fabrication — only what the tools reported). */
function gatherFindings(): Finding[] {
  const out: Finding[] = [];
  for (const [file, arrKey] of [["CRITIC.json", "findings"], ["DOD.json", "findings"]] as const) {
    const j = readJson(file);
    for (const f of (j?.[arrKey] ?? [])) out.push({ kind: f.kind ?? f.criticality, target: f.target ?? f.file, detail: f.detail ?? f.summary ?? f.text });
  }
  const req = readJson("REQUIREMENTS.json");
  if (req?.top) out.push({ kind: req.top.criticality, target: req.top.target, detail: req.top.detail ?? req.top.summary });
  const fs = existsSync(join(ORCH_DIR, "FLEET_STATUS.md")) ? readFileSync(join(ORCH_DIR, "FLEET_STATUS.md"), "utf8") : "";
  for (const line of fs.split("\n")) if (/BLOCKED|not gated|⏳/.test(line) && /\|/.test(line)) out.push({ kind: "fleet", detail: line.replace(/[|*`]/g, " ").trim().slice(0, 100) });
  return out;
}

function nowIso(): string { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }

function main(): void {
  const registry = loadRegistry();
  const findings = gatherFindings();
  const summary = thinkAll(findings, registry);
  const ts = nowIso();
  writeFileSync(join(ORCH_DIR, "THINK.md"), renderThink(summary, ts) + "\n");
  if (JSON_OUT) { console.log(JSON.stringify({ ts, registrySize: registry.length, ...summary })); return; }
  console.log(`🧠 think · registry ${registry.length} proven · ${summary.total} problem · ${summary.proven} PROVEN · ${summary.needsResearch} NEEDS-RESEARCH → THINK.md`);
  for (const r of summary.results.slice(0, 8)) {
    if (r.result.status === "PROVEN") console.log(`  ✅ ${r.result.category}: ${r.result.solution.slice(0, 60)} [${r.result.sources.length} src]`);
    else console.log(`  🔬 NEEDS-RESEARCH: ${r.result.probe.slice(0, 60)}`);
  }
}

main();
