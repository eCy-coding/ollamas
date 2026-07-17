#!/usr/bin/env tsx
/**
 * orchestration/bin/org-sandbox.ts — sustained sandbox harness for the management layer (IO shell
 * around the pure lib/sandbox-round.ts core; MAPE-K loop, RESEARCH-ORG.md §3).
 *
 * FULLY ISOLATED: everything lives in a mkdtemp dir — the synthetic ORG_CHART, the ledger
 * (ORG_STATE_DIR), and the ERR-ORG proposals (orchDir override). The harness asserts the REAL repo
 * files and the REAL ~/.ollamas ledger are untouched after the run (isolation invariant). Each round
 * dispatches a synthetic task wave through the real engine with chaos injections (actor-down,
 * seeded repeat-failure, recurrence override) and checks the invariants; any breach → exit 1.
 * A clean N-round streak is the sustainability proof → SANDBOX-ORG.md.
 *
 * Run:
 *   tsx orchestration/bin/org-sandbox.ts --rounds 10           # soak (default 5)
 *   tsx orchestration/bin/org-sandbox.ts --json                # machine output
 *   tsx orchestration/bin/org-sandbox.ts --watch 600           # continuous (a full soak every 600s)
 */
import { writeFileSync, mkdtempSync, existsSync, statSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseOrgChart, type LedgerEntry, type ErrorEntryProposal, type PreventionRule } from "./lib/organization";
import { loadPreventionRules, proposeErrorEntry, appendJsonl } from "./lib/org-io";
import { runRound, proposalsAsRules, bootstrapHistory, SANDBOX_CHART_JSON, waveFor } from "./lib/sandbox-round";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes("--json");
const ROUNDS = Number(flag("--rounds") || 5);
const WATCH_SEC = argv.includes("--watch") ? Number(flag("--watch") || 600) || 600 : 0;

interface RoundReport { round: number; down: string[]; dispatches: number; failures: number; proposals: number; ledgerSize: number; violations: string[]; }

/** Snapshot (mtime+size or "absent") of the real files the sandbox must never touch. */
function fingerprint(p: string): string {
  return existsSync(p) ? `${statSync(p).mtimeMs}:${statSync(p).size}` : "absent";
}

function soak(rounds: number): { allGreen: boolean; reports: RoundReport[]; violations: string[] } {
  const sandbox = mkdtempSync(join(tmpdir(), "org-sandbox-"));
  const stateDir = join(sandbox, "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(sandbox, "ORG_CHART.json"), JSON.stringify(SANDBOX_CHART_JSON, null, 2));
  const chart = parseOrgChart(SANDBOX_CHART_JSON);

  // Isolation invariant baseline: the real repo + real ledger must be byte-identical afterwards.
  const guarded = [
    join(ORCH_DIR, "ERRORS_PROPOSED.json"),
    join(ORCH_DIR, "errors_registry.json"),
    join(homedir(), ".ollamas", "brain-ledger.jsonl"),
  ];
  const before = guarded.map(fingerprint);

  const staticRules: PreventionRule[] = loadPreventionRules(REPO); // real registries are read-only knowledge
  const ts = new Date().toISOString();
  let ledger: LedgerEntry[] = bootstrapHistory(ts);
  const allProposals: ErrorEntryProposal[] = [];
  let seq = 1;
  const reports: RoundReport[] = [];
  const violations: string[] = [];

  for (let round = 1; round <= rounds; round++) {
    const down = round % 2 === 0 ? ["vision"] : [];
    const prevLedgerSize = ledger.length;
    const r = runRound({
      chart,
      rules: [...staticRules, ...proposalsAsRules(allProposals)],
      ledger, round, downActors: down, nextErrorSeq: seq, ts,
    });
    ledger = [...ledger, ...r.newLedger];
    for (const p of r.newProposals) { allProposals.push(p); proposeErrorEntry(p, sandbox); }
    for (const e of r.newLedger) appendJsonl("brain-ledger.jsonl", e, stateDir);
    seq = r.nextErrorSeq;

    if (ledger.length <= prevLedgerSize) r.violations.push(`round ${round}: ledger did not grow`);
    const ids = allProposals.map((p) => p.id);
    if (new Set(ids).size !== ids.length) r.violations.push(`round ${round}: duplicate ERR-ORG ids across rounds`);

    reports.push({
      round, down,
      dispatches: r.dispatches.length,
      failures: r.dispatches.filter((d) => !d.ok).length,
      proposals: r.newProposals.length,
      ledgerSize: ledger.length,
      violations: r.violations,
    });
    violations.push(...r.violations);
  }

  // Isolation invariant: nothing real changed.
  guarded.forEach((p, i) => {
    if (fingerprint(p) !== before[i]) violations.push(`ISOLATION BREACH: ${p} changed during the sandbox run`);
  });

  rmSync(sandbox, { recursive: true, force: true });
  return { allGreen: violations.length === 0, reports, violations };
}

function report(rounds: number): number {
  const { allGreen, reports, violations } = soak(rounds);
  if (JSON_OUT) { console.log(JSON.stringify({ allGreen, rounds, waveSize: waveFor(1).length, reports, violations })); return allGreen ? 0 : 1; }
  const md = [
    `# SANDBOX-ORG — sustained management-layer soak (isolated, stub runner, no GPU)`,
    ``,
    `- rounds: **${rounds}** · wave: ${waveFor(1).length} tasks/round · chaos: vision-down on even rounds, seeded repeat-failures, recurrence override`,
    `- violations: **${violations.length}** (must be 0)`,
    ``,
    `**VERDICT: ${allGreen ? `ALL GREEN ✅ (${rounds}-round clean streak = sustainability proof)` : "RED ❌"}**`,
    ``,
    `| round | down | dispatches | failures | proposals | ledger | violations |`,
    `|-------|------|------------|----------|-----------|--------|------------|`,
    ...reports.map((r) => `| ${r.round} | ${r.down.join(",") || "—"} | ${r.dispatches} | ${r.failures} | ${r.proposals} | ${r.ledgerSize} | ${r.violations.length ? r.violations.join("; ") : "—"} |`),
    ``,
    `> Proven per round: route-away from failed/down actors, prevention-rule injection verbatim from`,
    `> the accumulated proposals, recurrence detection + hardening, evidence-weighted routing, ledger`,
    `> monotonic growth, unique ERR-ORG ids, and REAL repo/ledger isolation (fingerprint-checked).`,
    `> Rerun: \`tsx orchestration/bin/org-sandbox.ts --rounds ${rounds}\`. Continuous: \`--watch 600\`.`,
  ].join("\n");
  writeFileSync(join(ORCH_DIR, "SANDBOX-ORG.md"), md + "\n");
  process.stdout.write(md + "\n");
  return allGreen ? 0 : 1;
}

async function main(): Promise<void> {
  if (WATCH_SEC > 0) {
    // Continuous mode: a full soak per cycle; keeps running on RED (the report shows it) — the
    // sustained watcher is the MAPE-K loop that never sleeps. Ctrl-C / launchd manages lifetime.
    for (;;) {
      const code = report(ROUNDS);
      process.stderr.write(`[org-sandbox] cycle done (${code === 0 ? "GREEN" : "RED"}) · next in ${WATCH_SEC}s\n`);
      await new Promise((r) => setTimeout(r, WATCH_SEC * 1000));
    }
  }
  process.exit(report(ROUNDS));
}

main().catch((e) => { console.error("[org-sandbox] fatal:", (e as Error)?.message ?? e); process.exit(1); });
