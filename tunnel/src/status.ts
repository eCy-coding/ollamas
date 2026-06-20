// Observability (vT6): PURE status rendering from the switch's decision log + a secret-free
// JSONL feed the orchestration cockpit can tail. Adoption (pattern only): node-sparkline (MIT,
// zero-dep) for ▁▂▃▄▅▆▇█; nodejs-cli-apps-best-practices (--json opt-out); Gatus/Burnd JSONL feed.
//
// Render fns are PURE (no I/O) → unit-testable. appendDecision/readDecisions are the only I/O.
// The decision log is already secret-free (RISK-013): names/latency/score/breaker/reason only.

import { appendFileSync, readFileSync } from "node:fs";
import type { DecisionRecord } from "./switch.ts";

export interface TransportStatus {
  name: string;
  priority: number;
  healthy: boolean;
  latencyMs: number;
  breaker: string;
  score: number;
}

export interface StatusReport {
  ts: number;
  active: string | null;
  reason: string;
  switched: boolean;
  transports: TransportStatus[];
  /** Per-transport latency series (finite samples only), oldest→newest. */
  history: Record<string, number[]>;
}

/** PURE: fold the decision log into a status snapshot. */
export function statusReport(decisions: DecisionRecord[], opts: { now?: number } = {}): StatusReport {
  const last = decisions.at(-1) ?? null;
  const history: Record<string, number[]> = {};
  for (const d of decisions) {
    for (const s of d.scores) {
      if (Number.isFinite(s.latencyMs)) (history[s.name] ??= []).push(s.latencyMs);
    }
  }
  return {
    ts: last?.ts ?? opts.now ?? 0,
    active: last?.winner ?? null,
    reason: last?.reason ?? "no decisions yet",
    switched: last?.switched ?? false,
    transports: last
      ? last.scores.map((s) => ({
          name: s.name,
          priority: s.priority,
          healthy: s.healthy,
          latencyMs: s.latencyMs,
          breaker: s.breaker,
          score: s.score,
        }))
      : [],
    history,
  };
}

const TICKS = [..."▁▂▃▄▅▆▇█"];

/** PURE: render a value series as a sparkline. Empty → "". Equal values → flat low ticks. */
export function sparkline(values: number[]): string {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return "";
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  return finite
    .map((v) => {
      if (span === 0) return TICKS[0] ?? "▁";
      const idx = Math.round(((v - min) / span) * (TICKS.length - 1));
      return TICKS[idx] ?? "▁";
    })
    .join("");
}

/** PURE: human-readable status table (best score first, active marked ►). */
export function renderStatusTable(r: StatusReport): string {
  if (r.transports.length === 0) return "no active transport (no decisions yet — run `tunnel auto`)";
  const lines = [`active: ${r.active ?? "none"}  ·  ${r.reason}`, ""];
  const rows = [...r.transports].sort((a, b) => a.score - b.score);
  for (const t of rows) {
    const mark = t.name === r.active ? "►" : " ";
    const lat = Number.isFinite(t.latencyMs) ? `${t.latencyMs.toFixed(0)}ms` : "-";
    const score = Number.isFinite(t.score) ? t.score.toFixed(0) : "∞";
    const spark = sparkline(r.history[t.name] ?? []);
    lines.push(
      `${mark} ${t.name.padEnd(10)} ${lat.padStart(7)}  ${t.breaker.padEnd(9)} score=${score.padStart(4)}  ${spark}`,
    );
  }
  return lines.join("\n");
}

/** Append one decision to a JSONL feed (secret-free). Best-effort; throws only on fatal fs error. */
export function appendDecision(path: string, record: DecisionRecord): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/**
 * Read the JSONL feed → records (graceful: missing file → [], bad lines skipped).
 * `limit` keeps only the last N records (size-cap on read; full rotation deferred to vT8).
 */
export function readDecisions(path: string, opts: { limit?: number } = {}): DecisionRecord[] {
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const out: DecisionRecord[] = [];
  for (const ln of lines) {
    try {
      out.push(JSON.parse(ln) as DecisionRecord);
    } catch {
      // skip malformed line (graceful, never throw)
    }
  }
  // size-cap on read: keep the last N VALID records (full rotation deferred to vT8).
  return opts.limit ? out.slice(-opts.limit) : out;
}
