#!/usr/bin/env tsx
/**
 * orchestration/bin/fleet-next.ts — compute the prioritized NEXT-TASK queue after a fleet round.
 *
 * Reads the gated proposals (~/.llm-mission-control/fleet/reports/*.json with a `## Change`) + the THINK
 * loop's NEEDS_RESEARCH probes → ranks the next tasks (safe-additive apply → risky-edit apply → research)
 * → writes FLEET_NEXT.md. This is the conductor precomputing "what next" so the loop never idles blindly.
 *
 * Run:  tsx orchestration/bin/fleet-next.ts [--json]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { prioritizeNext, renderNext, type ProposalRef } from "./lib/fleet-next";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPORTS = join(homedir(), ".llm-mission-control", "fleet", "reports");
const JSON_OUT = process.argv.includes("--json");

/** Gated proposals = reports whose messages contain a `## Change` block. */
function gatedProposals(): ProposalRef[] {
  if (!existsSync(REPORTS)) return [];
  const out: ProposalRef[] = [];
  for (const f of readdirSync(REPORTS)) {
    if (!f.endsWith(".json")) continue;
    const [stream, slot] = f.replace(/\.json$/, "").split(".");
    try {
      const j = JSON.parse(readFileSync(join(REPORTS, f), "utf8"));
      const msgs = Array.isArray(j.messages) ? j.messages.map(String).join("\n") : "";
      const i = msgs.search(/##\s*Change/i);
      if (i >= 0 && (j.verdict === "DONE" || j.verdict === "OK")) out.push({ stream, slot, proposal: msgs.slice(i) });
    } catch { /* skip */ }
  }
  // one proposal per stream (prefer the first gated slot)
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.stream) ? false : (seen.add(p.stream), true)));
}

/** NEEDS_RESEARCH probes from THINK.md: a `- Problem:` line inside a NEEDS_RESEARCH section. */
function researchProbes(): string[] {
  const f = join(ORCH_DIR, "THINK.md");
  if (!existsSync(f)) return [];
  const lines = readFileSync(f, "utf8").split("\n");
  const out: string[] = [];
  let inResearch = false;
  for (const l of lines) {
    if (/^##\s/.test(l)) inResearch = /NEEDS_RESEARCH/i.test(l);
    else if (inResearch) { const m = /-\s*Problem:\s*(.+)/i.exec(l); if (m) out.push(m[1].trim()); }
  }
  return [...new Set(out)].slice(0, 20);
}

function nowIso(): string { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }

function main(): void {
  const proposals = gatedProposals();
  // THINK.json (if think --json ran) carries the needsResearch count; probes are best-effort from THINK.md
  const probes = researchProbes();
  const queue = prioritizeNext(proposals, probes);
  const ts = nowIso();
  writeFileSync(join(ORCH_DIR, "FLEET_NEXT.md"), renderNext(queue, ts) + "\n");
  if (JSON_OUT) { console.log(JSON.stringify({ ts, tasks: queue })); return; }
  const p1 = queue.filter((t) => t.priority === 1);
  console.log(`⏭️  fleet-next · ${queue.length} task · ${p1.length} safe-additive (P1) → FLEET_NEXT.md`);
  for (const t of queue.slice(0, 8)) console.log(`  P${t.priority} ${t.kind} · ${t.stream} · ${t.target}`);
}

main();
