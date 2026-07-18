// Brain observability (S21) — brain gauges on the EXISTING prom-client /metrics
// surface, so tier bloat, fact churn, drift and recall latency regress visibly
// instead of silently. Two collection modes:
//   • poll-on-scrape (registerStoreMetrics precedent): cheap sqlite COUNTs via
//     brainStats() inside prom-client collect() callbacks — the drift probe is
//     NEVER run at scrape time (it embeds); self-hit/exit come from the LAST
//     maintain-log line instead (the nightly pass already paid for the probe).
//   • push: observeRecallLatency(ms) — recorded around the module-level
//     brainRecall wrapper only, so internal probe recalls don't skew the histogram.
// BRAIN_METRICS=0 opts out. Every collect is try/caught: a brain hiccup must
// never break the whole /metrics scrape.
import client from "prom-client";
import { readFileSync } from "node:fs";
import { register } from "./metrics";
import type { BrainStore } from "./brain";

const on = () => process.env.BRAIN_METRICS !== "0";

export interface MaintainTail {
  selfHitRate: number | null;
  exitCode: number | null;
}

/** Pure: fold a maintain log's text into the LAST brain.maintain line's
 *  {selfHitRate, exitCode}. Tolerant: non-JSON noise (launchd getcwd warnings,
 *  node experimental banners) and bad lines are skipped; absent → nulls. */
export function parseLastMaintain(logText: string): MaintainTail {
  let out: MaintainTail = { selfHitRate: null, exitCode: null };
  for (const line of logText.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.includes('"brain.maintain"')) continue;
    try {
      const j = JSON.parse(t) as { event?: string; selfHitRate?: unknown; exitCode?: unknown };
      if (j.event !== "brain.maintain") continue;
      out = {
        selfHitRate: typeof j.selfHitRate === "number" ? j.selfHitRate : null,
        exitCode: typeof j.exitCode === "number" ? j.exitCode : null,
      };
    } catch { /* skip bad line */ }
  }
  return out;
}

const recallMs = new client.Histogram({
  name: "ollamas_brain_recall_ms",
  help: "Brain recall duration in milliseconds (external recalls only; drift-probe recalls excluded)",
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

/** Push-side: called from the brainRecall wrapper (server/brain.ts). */
export function observeRecallLatency(ms: number): void {
  if (!on()) return;
  try { recallMs.observe(ms); } catch { /* metrics must never break recall */ }
}

let brainMetricsRegistered = false;

/** Register the pull-time brain gauges once at boot (idempotent — prom-client
 *  throws on duplicate names, mirroring registerStoreMetrics' guard). */
export function registerBrainMetrics(
  store: Pick<BrainStore, "stats">,
  opts: { maintainLogPath?: string } = {},
): void {
  if (brainMetricsRegistered || !on()) return;
  brainMetricsRegistered = true;
  const logPath = () =>
    opts.maintainLogPath || process.env.BRAIN_MAINTAIN_LOG || "/tmp/ollamas-brain-maintain.log";

  new client.Gauge({
    name: "ollamas_brain_memories",
    help: "Brain memories by tier",
    labelNames: ["tier"],
    registers: [register],
    collect() {
      try {
        const s = store.stats();
        for (const [tier, n] of Object.entries(s.memories)) this.labels(tier).set(n);
      } catch { /* scrape survives a brain hiccup */ }
    },
  });
  new client.Gauge({
    name: "ollamas_brain_facts",
    help: "Brain bi-temporal facts by status (live|superseded)",
    labelNames: ["status"],
    registers: [register],
    collect() {
      try {
        const s = store.stats();
        this.labels("live").set(s.facts);
        this.labels("superseded").set(s.factsSuperseded);
      } catch { /* tolerant */ }
    },
  });
  new client.Gauge({
    name: "ollamas_brain_db_bytes",
    help: "brain.db size in bytes",
    registers: [register],
    collect() {
      try { this.set(store.stats().dbBytes); } catch { /* tolerant */ }
    },
  });
  new client.Gauge({
    name: "ollamas_brain_embed_cache_rows",
    help: "Persistent embed-cache rows in brain.db",
    registers: [register],
    collect() {
      try { this.set(store.stats().embedCacheRows); } catch { /* tolerant */ }
    },
  });
  new client.Gauge({
    name: "ollamas_brain_self_hit_rate",
    help: "Drift-probe self-hit rate from the LAST maintenance pass (1 = healthy; absent until first pass)",
    registers: [register],
    collect() {
      try {
        const t = parseLastMaintain(readFileSync(logPath(), "utf8"));
        if (t.selfHitRate !== null) this.set(t.selfHitRate);
      } catch { /* no log yet */ }
    },
  });
  new client.Gauge({
    name: "ollamas_brain_last_maintain_exit",
    help: "Exit code of the last maintenance pass (0 healthy, 3 drift/MRR alarm; absent until first pass)",
    registers: [register],
    collect() {
      try {
        const t = parseLastMaintain(readFileSync(logPath(), "utf8"));
        if (t.exitCode !== null) this.set(t.exitCode);
      } catch { /* no log yet */ }
    },
  });
}
