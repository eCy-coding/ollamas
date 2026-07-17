/**
 * orchestration/bin/lib/brain-ledger.ts — the brain adapter for the management layer.
 *
 * Main does not (yet) ship the full 5-tier brain (it lives in the integrate worktree, merge-blocked);
 * production launchd serves from main. This adapter mirrors the brain's call surface —
 * `remember(tier, fact, meta)` / `recall(query, k)` — over an append-only JSONL ledger at
 * `~/.ollamas/brain-ledger.jsonl`, so EVERY management operation is recorded TODAY and the backend can
 * swap to `POST /api/brain/*` after the parent-lane ff-merge with zero call-site changes.
 *
 * Recall is substring/token-overlap for now (an embedding recall via nomic-embed, threshold 0.70 —
 * the ecy-brain convention — is a drop-in upgrade behind the same signature).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { appendJsonl } from "./org-io";
import { tokenize } from "./organization";

export type BrainTier = "episodic" | "learned";

export interface BrainRecord {
  ts: string;
  tier: BrainTier;
  fact: string;
  meta?: Record<string, unknown>;
}

const LEDGER_FILE = "brain-ledger.jsonl";

function stateDir(): string {
  return process.env.ORG_STATE_DIR || join(homedir(), ".ollamas");
}

/** Append one memory to the ledger. `ts` injected for determinism (tests pass a fixed clock). */
export function remember(tier: BrainTier, fact: string, meta?: Record<string, unknown>, ts?: string): BrainRecord {
  const rec: BrainRecord = { ts: ts ?? new Date().toISOString(), tier, fact, meta };
  appendJsonl(LEDGER_FILE, rec, stateDir());
  return rec;
}

/** Read the whole ledger (tolerant: missing file / bad lines → skipped). */
export function readLedger(): BrainRecord[] {
  const path = join(stateDir(), LEDGER_FILE);
  if (!existsSync(path)) return [];
  const out: BrainRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as BrainRecord;
      if (typeof r.fact === "string" && (r.tier === "episodic" || r.tier === "learned")) out.push(r);
    } catch { /* skip bad line */ }
  }
  return out;
}

/** Top-k records by token overlap with the query (learned tier weighted 2× — lessons outrank events). */
export function recall(query: string, k = 5): BrainRecord[] {
  const q = new Set(tokenize(query));
  if (q.size === 0) return [];
  return readLedger()
    .map((r) => {
      const overlap = new Set(tokenize(r.fact).filter((t) => q.has(t))).size;
      return { r, score: overlap * (r.tier === "learned" ? 2 : 1) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.r.ts < b.r.ts ? 1 : -1))
    .slice(0, k)
    .map((s) => s.r);
}
