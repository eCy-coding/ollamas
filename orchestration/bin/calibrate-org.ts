#!/usr/bin/env tsx
/**
 * orchestration/bin/calibrate-org.ts — e2e calibration of the management/organization layer.
 *
 * Proves the full dispatch ritual (consult-errors → assign → brief → dispatch → record) end-to-end on
 * synthetic tasks across every routing class, with a STUB runner (no GPU, no network): (1) each task
 * routes to the expected actor (cheapest capable), (2) every dispatch+outcome lands in the brain ledger,
 * (3) a seeded trap task gets its known prevention rule injected into the brief, (4) a seeded failure
 * produces an ERR-ORG registry-append PROPOSAL (written to a scratch dir — the repo is never mutated).
 * Tallies → CALIBRATION-ORG.md (+ --json). Same contract as calibrate.ts: a per-task failure never
 * aborts the batch; exit 1 only when a check fails (the loop iterates until ALL GREEN).
 *
 * Run:
 *   tsx orchestration/bin/calibrate-org.ts            # full calibration, writes CALIBRATION-ORG.md
 *   tsx orchestration/bin/calibrate-org.ts --json     # machine output
 */
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assignRole, consultErrors, faultsAsRules, buildDispatchPrompt, recordOutcome,
  type TaskSpec,
} from "./lib/organization";
import { loadOrgChart, loadPreventionRules, nextErrorSeq, proposeErrorEntry } from "./lib/org-io";
import { remember, readLedger } from "./lib/brain-ledger";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const JSON_OUT = process.argv.includes("--json");

/** Synthetic calibration tasks — one per routing class + two seeded traps. */
const SYNTHETIC: Array<{ task: TaskSpec; expectActor: string; expectRuleId?: string; forceFail?: boolean }> = [
  { task: { id: "cal-code", goal: "fix the failing parser in the CLI", cls: "code" }, expectActor: "conductor" },
  { task: { id: "cal-repair", goal: "author a SEARCH/REPLACE proposal for the router", cls: "repair" }, expectActor: "conductor" },
  { task: { id: "cal-review", goal: "review this diff quickly", cls: "review" }, expectActor: "joker" },
  { task: { id: "cal-vision", goal: "analyze this UI screenshot for layout drift", cls: "vision" }, expectActor: "vision" },
  { task: { id: "cal-embed", goal: "semantic search for duplicate helpers", cls: "embed" }, expectActor: "librarian" },
  { task: { id: "cal-research", goal: "research upstream best practice", cls: "research" }, expectActor: "odysseus" },
  { task: { id: "cal-personal", goal: "route a personal request", cls: "personal" }, expectActor: "ecym" },
  { task: { id: "cal-surge", goal: "absorb surge load in parallel", cls: "surge" }, expectActor: "cloud-pool" },
  { task: { id: "cal-reasoning", goal: "verify the algorithm invariant", cls: "reasoning" }, expectActor: "seat:reasoning" },
  { task: { id: "cal-triage", goal: "triage and prioritize the findings", cls: "cheap-triage" }, expectActor: "seat:cheap-triage" },
  // Trap 1: task text overlaps ERR-ORCH-006 (git add -A) → its prevention rule MUST be in the brief.
  {
    task: { id: "cal-trap-commit", goal: "commit the staged files with git add in the shared multi-lane tree", cls: "code", tags: ["git", "commit", "stage"] },
    expectActor: "conductor", expectRuleId: "ERR-ORCH-006",
  },
  // Trap 2: odysseus dispatch → its knownFault (ok:true with error-in-text) MUST be in the brief; forced failure → ERR-ORG proposal.
  {
    task: { id: "cal-trap-ody", goal: "record success from the bridge response payload after an agent run", cls: "research", tags: ["bridge", "ok", "payload"] },
    expectActor: "odysseus", expectRuleId: "ORG-FAULT-ODY-001", forceFail: true,
  },
];

interface Row { id: string; actor: string; routeOk: boolean; briefRuleOk: boolean | null; ledgerOk: boolean; proposalOk: boolean | null; reason: string; }

function main(): void {
  const chart = loadOrgChart(ORCH_DIR);
  const rules = loadPreventionRules();
  const scratch = mkdtempSync(join(tmpdir(), "calibrate-org-")); // proposals land here — repo never mutated
  const ts = new Date().toISOString();
  const ledgerBefore = readLedger().length;
  const rows: Row[] = [];
  let crashes = 0;

  for (const s of SYNTHETIC) {
    try {
      // 1) assign (cheapest capable)
      const a = assignRole(chart, s.task);
      const routeOk = a.actorId === s.expectActor && a.reason === "capability-match";
      // 2) consult-errors (registries + assignee knownFaults) → 3) brief
      const hits = consultErrors([...rules, ...faultsAsRules(a)], s.task);
      const brief = buildDispatchPrompt(chart, a, s.task, hits);
      const briefRuleOk = s.expectRuleId ? brief.includes(`[${s.expectRuleId}]`) : null;
      // 4) dispatch (STUB runner — deterministic, no GPU) + record dispatch to the brain ledger
      remember("episodic", `dispatch ${s.task.id} → ${a.actorId} (${a.model ?? "service"})`, { rules: hits.map((h) => h.id) }, ts);
      const ok = !s.forceFail;
      // 5) record outcome (+ failure → registry-append proposal in the scratch dir)
      const rec = recordOutcome(
        { taskId: s.task.id, actorId: a.actorId, ok, summary: ok ? "stub run ok" : "stub run failed (seeded)", ts, error: ok ? undefined : "seeded failure: bridge ok:true with error-in-text" },
        { rulesApplied: hits.map((h) => h.id), nextErrorSeq: nextErrorSeq(ORCH_DIR) },
      );
      remember(rec.ledger.tier, `${rec.ledger.type} ${s.task.id}: ${rec.ledger.summary}`, { actorId: a.actorId, ok }, ts);
      let proposalOk: boolean | null = null;
      if (!ok) {
        if (!rec.registryAppend) proposalOk = false;
        else {
          const p = proposeErrorEntry(rec.registryAppend, scratch);
          const arr = JSON.parse(readFileSync(p, "utf8")) as Array<{ id: string; prevention_rule: string }>;
          proposalOk = arr.some((e) => e.id === rec.registryAppend!.id && e.prevention_rule.length > 0);
        }
      }
      const ledgerOk = true; // verified in aggregate below (count delta)
      rows.push({ id: s.task.id, actor: a.actorId, routeOk, briefRuleOk, ledgerOk, proposalOk, reason: routeOk ? "ok" : `routed ${a.actorId} (${a.reason}), expected ${s.expectActor}` });
    } catch (e) {
      crashes++;
      rows.push({ id: s.task.id, actor: "-", routeOk: false, briefRuleOk: null, ledgerOk: false, proposalOk: null, reason: `error: ${(e as Error).message.slice(0, 80)}` });
    }
  }

  // Aggregate ledger evidence: 2 entries per task (dispatch + outcome).
  const ledgerAfter = readLedger().length;
  const ledgerDelta = ledgerAfter - ledgerBefore;
  const ledgerAllOk = ledgerDelta >= SYNTHETIC.length * 2 - crashes * 2;

  const n = rows.length;
  const sum = {
    total: n,
    routeOk: rows.filter((r) => r.routeOk).length,
    briefRuleOk: rows.filter((r) => r.briefRuleOk === true).length,
    briefRuleChecked: rows.filter((r) => r.briefRuleOk !== null).length,
    proposalOk: rows.filter((r) => r.proposalOk === true).length,
    proposalChecked: rows.filter((r) => r.proposalOk !== null).length,
    ledgerDelta, crashes,
  };
  const allGreen = sum.routeOk === n && sum.briefRuleOk === sum.briefRuleChecked && sum.proposalOk === sum.proposalChecked && ledgerAllOk && crashes === 0;

  if (JSON_OUT) { console.log(JSON.stringify({ allGreen, ...sum, rows })); process.exit(allGreen ? 0 : 1); }

  const md = [
    `# CALIBRATION-ORG — management-layer dispatch ritual (stub runner, no GPU)`,
    ``,
    `- route to expected actor: **${sum.routeOk}/${n}**`,
    `- prevention rule injected on trap tasks: **${sum.briefRuleOk}/${sum.briefRuleChecked}**`,
    `- failure → ERR-ORG registry-append proposal: **${sum.proposalOk}/${sum.proposalChecked}**`,
    `- brain-ledger entries written this run: **${ledgerDelta}** (expected ≥ ${n * 2})`,
    `- crashes: **${crashes}** (must be 0)`,
    ``,
    `**VERDICT: ${allGreen ? "ALL GREEN ✅" : "RED ❌"}**`,
    ``,
    ...rows.map((r) => `- ${r.routeOk ? "✅" : "❌"} ${r.id} → ${r.actor}${r.briefRuleOk !== null ? ` · rule ${r.briefRuleOk ? "✓" : "✗"}` : ""}${r.proposalOk !== null ? ` · proposal ${r.proposalOk ? "✓" : "✗"}` : ""} (${r.reason})`),
    ``,
    `> The ritual: consult-errors → assign → brief → dispatch → record (ORGANIZATION.md §3).`,
    `> Rerun: \`tsx orchestration/bin/calibrate-org.ts\`. Ledger: \`~/.ollamas/brain-ledger.jsonl\`.`,
  ].join("\n");
  writeFileSync(join(ORCH_DIR, "CALIBRATION-ORG.md"), md + "\n");
  process.stdout.write(md + "\n");
  process.exit(allGreen ? 0 : 1);
}

main();
