// Brain event bus + ingest guard (S26 + S46) — the missing choke-point between
// ollamas subsystems and the brain. Design rationale (the decisive rule): sources
// with NO durable store (tool onUsage callbacks, provider-verdict transitions,
// pure council scores, distill completions) lose their signal the moment it
// happens — a nightly batch reads nothing. Those sources EMIT here; subscribers
// aggregate in memory and flush through brainRemember/brainAssertFact (so the
// S24 redaction gate and AUDN dedup always apply). Durable sources (jsonl logs,
// error ring, KEV catalog) stay maintain-time and don't need the bus.
//
// Contracts:
//   • emit() NEVER throws and never blocks the caller — handlers run async
//     (queueMicrotask), each individually try/caught; a broken subscriber can't
//     take down a chat turn or a provider call.
//   • budgetAllow(source) — shared daily write budget per ingest source
//     (BRAIN_INGEST_BUDGET, default 200/day/source): a chatty subsystem can rot
//     its own slice, never the whole brain. Denials are counted, not thrown.
//   • deterministicId(source, key) — the ONE id convention every bridge uses
//     (S18 org-mirror precedent: sha1 → idempotent re-emits/upserts). Code,
//     not convention.
//   • getBusStats() — emitted/handled/failed/denied per type+source, folded
//     into /metrics by S45 (dead-letter visibility for a best-effort bus).
import { createHash } from "node:crypto";

export type BrainEventType =
  | "tool.outcome"        // S30 — tool-registry onUsage
  | "provider.verdict"    // S32 — key-health verdict transition
  | "council.score"       // S33 — scoreCouncil result
  | "mcp.upstream"        // S35 — MCP supervisor health transition
  | "champion.change"     // S37 — model champion change
  | "session.distilled"   // S42 — distill completed for a session
  | "tenant.created"      // S43 — tenant provisioned
  | "selftest.ping";      // S50 — e2e proof probe

export interface BrainEvent {
  type: BrainEventType;
  /** Emitting subsystem id — also the budget key (e.g. "tool-registry"). */
  source: string;
  at: number;
  payload: Record<string, unknown>;
}

type Handler = (e: BrainEvent) => void | Promise<void>;

interface BusStats {
  emitted: Record<string, number>;
  handled: number;
  failed: number;
  denied: Record<string, number>;
}

const handlers = new Map<BrainEventType | "*", Set<Handler>>();
const stats: BusStats = { emitted: {}, handled: 0, failed: 0, denied: {} };

/** Subscribe to one event type (or "*" for all). Returns the unsubscribe fn. */
export function subscribe(type: BrainEventType | "*", handler: Handler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => { set.delete(handler); };
}

/** Fire-and-forget emit: async handler fan-out, individually isolated. */
export function emit(e: BrainEvent): void {
  try {
    stats.emitted[e.type] = (stats.emitted[e.type] ?? 0) + 1;
    const targets = [...(handlers.get(e.type) ?? []), ...(handlers.get("*") ?? [])];
    for (const h of targets) {
      queueMicrotask(() => {
        try {
          const r = h(e);
          if (r && typeof (r as Promise<void>).then === "function") {
            (r as Promise<void>).then(
              () => { stats.handled++; },
              () => { stats.failed++; },
            );
          } else {
            stats.handled++;
          }
        } catch {
          stats.failed++;
        }
      });
    }
  } catch { /* emit never throws — a bus bug must not break the emitter */ }
}

// ── S46: per-source daily ingest budget ──────────────────────────────────────
const dayOf = (t: number) => Math.floor(t / 86_400_000);
const budgetUsed = new Map<string, { day: number; used: number }>();

export function budgetCap(env: { BRAIN_INGEST_BUDGET?: string } = process.env): number {
  const n = Number(env.BRAIN_INGEST_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

/** True when `source` still has budget today; consumes one unit when allowed.
 *  Denials are counted into bus stats (S45 surfaces them). */
export function budgetAllow(source: string, now = Date.now()): boolean {
  const day = dayOf(now);
  let b = budgetUsed.get(source);
  if (!b || b.day !== day) {
    b = { day, used: 0 };
    budgetUsed.set(source, b);
  }
  if (b.used >= budgetCap()) {
    stats.denied[source] = (stats.denied[source] ?? 0) + 1;
    return false;
  }
  b.used++;
  return true;
}

// ── Shared idempotency convention ────────────────────────────────────────────
/** `source:sha1(key)` — every bridge writes with this id so re-emits, replays
 *  and re-runs upsert instead of duplicating (S18 org-mirror precedent). */
export function deterministicId(source: string, key: string): string {
  return `${source}:${createHash("sha1").update(key).digest("hex")}`;
}

/** Snapshot for S45 bus-metrics (copies — callers can't mutate live counters). */
export function getBusStats(): BusStats {
  return {
    emitted: { ...stats.emitted },
    handled: stats.handled,
    failed: stats.failed,
    denied: { ...stats.denied },
  };
}

/** Test seam: reset all in-memory state (never used in production paths). */
export function resetBusForTests(): void {
  handlers.clear();
  budgetUsed.clear();
  stats.emitted = {};
  stats.handled = 0;
  stats.failed = 0;
  stats.denied = {};
}
