#!/usr/bin/env tsx
/**
 * orchestration/bin/org-train.ts — the training step of the learned-authority loop (IO shell around
 * pure org-learn.trainPolicy; ORG v3, RESEARCH-ORG.md §v3).
 *
 * Reads the REAL brain ledger (~/.ollamas/brain-ledger.jsonl — every dispatch/outcome the management
 * layer recorded), reconstructs outcome entries, retrains the whole authority policy (promotion/
 * demotion on Wilson evidence, recurrence caps), writes it to orchestration/ORG_POLICY.json (the
 * "model weights" artifact the conductor loads advisorily), and remembers the training run itself in
 * the brain (learned tier). Online learning: run it after any episode — each run retrains from ALL
 * accumulated evidence. Safe: the policy is advisory routing input; it never touches the gates.
 *
 * Run:  tsx orchestration/bin/org-train.ts [--json]
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trainPolicy } from "./lib/org-learn";
import { readLedger, remember, type BrainRecord } from "./lib/brain-ledger";
import type { LedgerEntry } from "./lib/organization";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const JSON_OUT = process.argv.includes("--json");

/**
 * Reconstruct structured outcome entries from brain records. Only records whose meta carries a boolean
 * `ok` count as outcomes; actorId defaults to "conductor" (the orchestra path's actor) when absent.
 */
export function ledgerFromBrain(records: BrainRecord[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const r of records) {
    const ok = r.meta?.ok;
    if (typeof ok !== "boolean") continue;
    const actorId = typeof r.meta?.actorId === "string" ? (r.meta.actorId as string) : "conductor";
    const taskId = typeof r.meta?.taskId === "string" ? (r.meta.taskId as string)
      : (r.fact.match(/^(?:outcome|dispatch)\s+(\S+?):/)?.[1] ?? "unknown");
    const sig = typeof r.meta?.sig === "string" ? (r.meta.sig as string) : undefined;
    out.push({ type: "outcome", tier: r.tier, ts: r.ts, taskId, actorId, ok, summary: r.fact, ...(sig ? { sig } : {}) });
  }
  return out;
}

function main(): void {
  const records = readLedger();
  const entries = ledgerFromBrain(records);
  const now = new Date().toISOString();
  const policy = trainPolicy(entries, { now });
  const path = join(ORCH_DIR, "ORG_POLICY.json");
  writeFileSync(path, JSON.stringify(policy, null, 2) + "\n");

  const levels = Object.entries(policy.authorities)
    .map(([id, a]) => `${id}=${a.level}(n=${a.n},w=${a.wilson.toFixed(2)})`).join(" · ");
  remember("learned", `org policy trained: ${policy.samples} samples → ${Object.keys(policy.authorities).length} actors [${levels}]`, { samples: policy.samples }, now);

  if (JSON_OUT) { console.log(JSON.stringify(policy)); return; }
  process.stdout.write(`🎓 ORG policy trained → ${path}\n   samples=${policy.samples} · ${levels || "(no outcome evidence yet)"}\n`);
}

if (process.argv[1] && /org-train\.ts$/.test(process.argv[1])) main();
