/**
 * orchestration/bin/lib/brain-ledger.ts — the brain adapter for the management layer.
 *
 * The 5-tier brain now ships in main (B-port fe58efa) and serves on :3000. This adapter
 * keeps the sync call surface — `remember(tier, fact, meta)` / `recall(query, k)` — over the
 * append-only JSONL ledger at `~/.ollamas/brain-ledger.jsonl` (authoritative for sync recall,
 * survives a down server), and DUAL-WRITES every real-ledger memory into the brain via
 * fire-and-forget `POST /api/brain/remember` (ns "org", deterministic ids → idempotent).
 * The mirror is skipped under ORG_STATE_DIR (tests/sandbox must never touch the real brain)
 * and can be disabled with ORG_BRAIN_MIRROR=0.
 *
 * Recall stays local token-overlap: callers are sync (conductor FSM hot path) and the JSONL
 * is a complete superset of what was mirrored.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
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

/** Map a ledger record to the brain's remember payload. Deterministic id (sha1 of ts|fact)
 *  makes both the live mirror and the one-shot migration idempotent; original event time
 *  is preserved so tier recency decay stays truthful. Shared with scripts/brain-ledger-migrate.ts. */
export function toBrainInput(rec: BrainRecord): {
  id: string; tier: BrainTier; content: string; source: string; ns: string; createdAt?: number;
} {
  const parsed = Date.parse(rec.ts);
  return {
    id: `org:${createHash("sha1").update(`${rec.ts}|${rec.fact}`).digest("hex")}`,
    tier: rec.tier,
    content: (rec.meta ? `${rec.fact} :: ${JSON.stringify(rec.meta)}` : rec.fact).slice(0, 500),
    source: "org-ledger",
    ns: "org",
    createdAt: Number.isFinite(parsed) ? parsed : undefined,
  };
}

/** Fire-and-forget mirror into the 5-tier brain. Best-effort by contract: a down server,
 *  an old server without the route, or a slow embed must never stall the conductor FSM. */
function mirrorToBrain(rec: BrainRecord): void {
  const mode = process.env.ORG_BRAIN_MIRROR;
  if (mode === "0") return;
  // Test/sandbox seam: an isolated state dir implies an isolated run — never touch the
  // real brain. ORG_BRAIN_MIRROR=1 force-enables (tests exercise the mirror with a mock).
  if (process.env.ORG_STATE_DIR && mode !== "1") return;
  const url = `${process.env.OLLAMAS_BRAIN_URL || "http://127.0.0.1:3000"}/api/brain/remember`;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toBrainInput(rec)),
    signal: AbortSignal.timeout(1500),
  }).catch(() => { /* best-effort mirror */ });
}

/** Append one memory to the ledger. `ts` injected for determinism (tests pass a fixed clock). */
export function remember(tier: BrainTier, fact: string, meta?: Record<string, unknown>, ts?: string): BrainRecord {
  const rec: BrainRecord = { ts: ts ?? new Date().toISOString(), tier, fact, meta };
  appendJsonl(LEDGER_FILE, rec, stateDir());
  mirrorToBrain(rec);
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
