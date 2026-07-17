/**
 * server/org-status.ts — read-only status source for the ORG management layer panel/endpoint.
 *
 * Aggregates the management-layer artifacts into one overview: the org chart
 * (orchestration/ORG_CHART.json), the LEARNED authority policy (orchestration/ORG_POLICY.json —
 * trained from the brain ledger by orchestration/bin/org-train.ts), the brain ledger tail
 * (~/.ollamas/brain-ledger.jsonl), and the latest sandbox/calibration verdict lines. Every source is
 * OPTIONAL and every read is tolerant (missing/malformed → null/empty) — this module must never take
 * the server down. Paths are injectable for tests. No writes, no network.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface OrgActorView {
  id: string;
  kind: string;
  role: string;
  costRank: number;
  authority: string | null;
  wilson: number | null;
  n: number | null;
  authorityReason: string | null;
}

export interface OrgLedgerRecord { ts: string; tier: string; fact: string; }

export interface OrgOverview {
  actors: OrgActorView[];
  policyTrainedAt: string | null;
  policySamples: number | null;
  ledgerCounts: { total: number; episodic: number; learned: number };
  ledgerTail: OrgLedgerRecord[];
  sandboxVerdict: string | null;
  calibrationVerdict: string | null;
}

function readJson(p: string): unknown {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function verdictLine(p: string): string | null {
  try {
    const m = readFileSync(p, "utf8").match(/\*\*VERDICT: ([^*\n]+)\*\*/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

export function orgOverview(opts?: { recent?: number; repoDir?: string; stateDir?: string }): OrgOverview {
  const repo = opts?.repoDir ?? process.cwd();
  const stateDir = opts?.stateDir ?? join(homedir(), ".ollamas");
  const recent = Math.min(Math.max(opts?.recent ?? 20, 1), 100);
  const orch = join(repo, "orchestration");

  const chart = readJson(join(orch, "ORG_CHART.json")) as { actors?: Array<Record<string, unknown>> } | null;
  const policy = readJson(join(orch, "ORG_POLICY.json")) as {
    trainedAt?: string; samples?: number;
    authorities?: Record<string, { level?: string; wilson?: number; n?: number; reason?: string }>;
  } | null;

  const actors: OrgActorView[] = (Array.isArray(chart?.actors) ? chart!.actors! : [])
    .filter((a) => typeof a.id === "string")
    .map((a) => {
      const auth = policy?.authorities?.[a.id as string];
      return {
        id: a.id as string,
        kind: typeof a.kind === "string" ? a.kind : "?",
        role: typeof a.role === "string" ? a.role : "",
        costRank: typeof a.costRank === "number" ? a.costRank : -1,
        authority: auth?.level ?? null,
        wilson: typeof auth?.wilson === "number" ? auth.wilson : null,
        n: typeof auth?.n === "number" ? auth.n : null,
        authorityReason: auth?.reason ?? null,
      };
    });

  const ledgerCounts = { total: 0, episodic: 0, learned: 0 };
  const ledgerTail: OrgLedgerRecord[] = [];
  const ledgerPath = join(stateDir, "brain-ledger.jsonl");
  if (existsSync(ledgerPath)) {
    try {
      const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim());
      const records: OrgLedgerRecord[] = [];
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as OrgLedgerRecord;
          if (typeof r.fact !== "string") continue;
          records.push(r);
          ledgerCounts.total += 1;
          if (r.tier === "episodic") ledgerCounts.episodic += 1;
          else if (r.tier === "learned") ledgerCounts.learned += 1;
        } catch { /* skip bad line */ }
      }
      ledgerTail.push(...records.slice(-recent).map((r) => ({ ts: r.ts, tier: r.tier, fact: r.fact })));
    } catch { /* tolerant */ }
  }

  return {
    actors,
    policyTrainedAt: policy?.trainedAt ?? null,
    policySamples: typeof policy?.samples === "number" ? policy.samples : null,
    ledgerCounts,
    ledgerTail,
    sandboxVerdict: verdictLine(join(orch, "SANDBOX-ORG.md")),
    calibrationVerdict: verdictLine(join(orch, "CALIBRATION-ORG.md")),
  };
}
