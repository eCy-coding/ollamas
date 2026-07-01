#!/usr/bin/env tsx
/**
 * orchestration/bin/fleet-conduct.ts — the CONDUCTOR side of the local model-fleet.
 *
 * Claude Code (or the autopilot) runs this to SUPERVISE the workers launched by fleet-launch.ts:
 * read every worker report + the live claim ledger → fold per stream (2-slot ensemble agreement) →
 * gate each PROPOSE result (verdict DONE, steps>0, not demo) → render FLEET_STATUS.md for CLAUDE
 * (not the user). This is the "report to Claude, Claude gives feedback" mechanism.
 *
 * Convergence = every launched stream has ≥1 gated-DONE ensemble half AND no active claims left.
 *
 * Run:
 *   tsx orchestration/bin/fleet-conduct.ts            # one pass: read reports+claims → FLEET_STATUS.md
 *   tsx orchestration/bin/fleet-conduct.ts --json     # machine output
 *   tsx orchestration/bin/fleet-conduct.ts --stop     # kill-switch: release all fleet claims
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { defaultStore, readClaims, activeClaims, closeClaim, type ClaimEvent } from "./lib/claims";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const SEYIR_DIR = join(ORCH_DIR, "seyir");
const FLEET_HOME = join(homedir(), ".llm-mission-control", "fleet");
const REPORTS = join(FLEET_HOME, "reports");
const JSON_OUT = process.argv.includes("--json");
const STOP = process.argv.includes("--stop");

interface WorkerReport { stream: string; slot: string; model?: string; verdict?: string; steps?: number; demoSuspected?: boolean; allOk?: boolean; proposal?: string; error?: string; }

/** Gate a single worker report: DONE/OK + real steps + not demo + a non-empty proposal (evidence-law). */
function gate(r: WorkerReport): { ok: boolean; reason: string } {
  if (r.error) return { ok: false, reason: r.error.slice(0, 60) };
  if (r.demoSuspected) return { ok: false, reason: "demo-suspected (steps=0, prose only)" };
  if (!(r.steps && r.steps > 0)) return { ok: false, reason: "no tool steps" };
  if (r.verdict !== "DONE" && r.verdict !== "OK") return { ok: false, reason: `verdict=${r.verdict ?? "?"}` };
  if (!r.proposal || r.proposal.length < 20) return { ok: false, reason: "no proposal content" };
  return { ok: true, reason: `${r.verdict} · ${r.steps} steps · proposal ${r.proposal.length}c` };
}

/** Extract the proposal text from a report's final messages (Change/Diff/Test shape). */
function extractProposal(messages: unknown): string {
  const arr = Array.isArray(messages) ? messages.map((m) => String(m)) : [];
  const joined = arr.join("\n").trim();
  // prefer the segment from the first "## Change" marker (the requested shape); else the last message
  const i = joined.search(/##\s*Change/i);
  return (i >= 0 ? joined.slice(i) : (arr[arr.length - 1] ?? "")).trim();
}

function readReports(): WorkerReport[] {
  if (!existsSync(REPORTS)) return [];
  const out: WorkerReport[] = [];
  for (const f of readdirSync(REPORTS)) {
    if (!f.endsWith(".json")) continue;
    const [stream, slot] = f.replace(/\.json$/, "").split(".");
    try {
      const j = JSON.parse(readFileSync(join(REPORTS, f), "utf8"));
      const proposal = extractProposal(j.messages);
      // conductor materializes PROPOSAL.md from the report (no worker file-write dependency)
      if (proposal && proposal.length >= 20) {
        const dir = join(homedir(), ".llm-mission-control", "fleet", "work", `${stream}.${slot}`);
        try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "PROPOSAL.md"), `# ${stream} · ${slot} · ${j.model ?? "?"}\n\n${proposal}\n`); } catch { /* best-effort */ }
      }
      out.push({ stream, slot, model: j.model, verdict: j.verdict, steps: (j.steps ?? []).length, demoSuspected: j.demoSuspected, allOk: j.allOk, proposal });
    } catch {
      out.push({ stream, slot, error: "report parse error / partial" });
    }
  }
  return out;
}

function killSwitch(): void {
  const store = defaultStore(SEYIR_DIR);
  const live = activeClaims(readClaims(store), Date.now());
  const tab = process.env.ORCH_TAB || "fleet-conductor";
  let n = 0;
  for (const c of live) { closeClaim(store, { lane: c.lane, version: c.version, tab, pid: process.pid, status: "released" }); n++; }
  console.log(`🛑 kill-switch: ${n} claim released.`);
}

function main(): void {
  if (STOP) return killSwitch();

  const reports = readReports();
  const store = defaultStore(SEYIR_DIR);
  const live: ClaimEvent[] = activeClaims(readClaims(store), Date.now());
  const streams = [...new Set(reports.map((r) => r.stream))];

  const perStream = streams.map((s) => {
    const halves = reports.filter((r) => r.stream === s).map((r) => ({ ...r, gate: gate(r) }));
    const gatedOk = halves.filter((h) => h.gate.ok).length;
    return { stream: s, halves, gatedOk, ensembleDone: gatedOk >= 1 };
  });
  const converged = perStream.length > 0 && perStream.every((p) => p.ensembleDone) && live.length === 0;

  if (JSON_OUT) { console.log(JSON.stringify({ ts: new Date().toISOString(), converged, activeClaims: live.length, perStream }, null, 2)); return; }

  const L = [
    `# FLEET_STATUS.md — conductor view (report to Claude, not user)`,
    ``, `> Auto: \`tsx orchestration/bin/fleet-conduct.ts\` · reports ${reports.length} · active claims ${live.length}`,
    `> Convergence: ${converged ? "✅ CONVERGED" : "⏳ in-progress"}`,
    ``, `| Stream | Ensemble | Gated slots | Detay |`, `|--------|----------|-------------|-------|`,
  ];
  for (const p of perStream) {
    const detail = p.halves.map((h) => `${h.slot}=${h.gate.ok ? "✅" : "❌"}(${h.model ?? "?"}: ${h.gate.reason})`).join(" · ");
    L.push(`| ${p.stream} | ${p.ensembleDone ? "✅" : "⏳"} | ${p.gatedOk}/${p.halves.length} | ${detail} |`);
  }
  if (live.length) { L.push(``, `## Active claims (running)`); for (const c of live) L.push(`- ${c.lane}|${c.version} → ${c.tab}`); }
  L.push(``, `## Conductor directive (next)`);
  if (!reports.length) L.push(`- No reports yet — launch: \`tsx orchestration/bin/fleet-launch.ts --go\``);
  else if (!converged) {
    const pending = perStream.filter((p) => !p.ensembleDone).map((p) => p.stream);
    L.push(`- Pending streams: ${pending.join(", ") || "(claims still active)"}. Re-run failed halves or wait for GPU queue.`);
  } else L.push(`- ✅ All streams gated-DONE. Review PROPOSAL.md in ~/.llm-mission-control/fleet/work/*, then apply green ones.`);
  writeFileSync(join(ORCH_DIR, "FLEET_STATUS.md"), L.join("\n") + "\n");

  console.log(`🛰  fleet-conduct · ${reports.length} report · ${perStream.filter((p) => p.ensembleDone).length}/${perStream.length} stream done · ${live.length} active · ${converged ? "✅ CONVERGED" : "⏳"}`);
  for (const p of perStream) console.log(`  ${p.ensembleDone ? "✅" : "⏳"} ${p.stream}: ${p.gatedOk}/${p.halves.length} gated`);
}

main();
