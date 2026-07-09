// @ts-check
// Observability stats core (scripts lane, v8) — PURE, no fs/network. Aggregates
// a list of seyir events into counts, latency percentiles, and an SLO burn-rate.
// Keeping it pure makes the dashboard math unit-testable without touching disk.
//
// Adopts: pure-JS percentile (linear interpolation, MIT gist pattern) and the
// google/slo-generator (Apache) error-budget burn-rate shape (EB=1-SLI, burn=EB/EB_target).

// Percentile of an ASCENDING-sorted numeric array (p in [0,1]). Linear interpolation.
export function percentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[n - 1];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = lo + 1;
  const w = idx - lo;
  if (hi >= n) return sortedAsc[lo];
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

const isError = (e) => e.status === "error" || e.exit !== 0;

// Summarize events → counts, error-rate, latency percentiles, per-tool breakdown.
export function summarize(events = []) {
  const total = events.length;
  if (total === 0) return { total: 0, errors: 0, errorRate: 0, p50: 0, p95: 0, p99: 0, avg: 0, byTool: {} };
  const errors = events.filter(isError).length;
  const lat = events.map((e) => Number(e.duration_ms) || 0).sort((a, b) => a - b);
  const sum = lat.reduce((a, b) => a + b, 0);
  const byTool = {};
  for (const e of events) {
    const t = e.tool || "unknown";
    (byTool[t] ||= { count: 0, errors: 0 });
    byTool[t].count++;
    if (isError(e)) byTool[t].errors++;
  }
  return {
    total,
    errors,
    errorRate: errors / total,
    p50: percentile(lat, 0.5),
    p95: percentile(lat, 0.95),
    p99: percentile(lat, 0.99),
    avg: sum / total,
    byTool,
  };
}

// SLO / error-budget burn-rate over a trailing window.
//   target=0.99 → 1% error budget. burnRate = observedErrorRate / budget.
//   alert when burnRate > burnAlert (default 1 → exceeding budget) AND there is traffic.
export function sloCheck(events = [], { target = 0.99, windowMs = 3600000, now = 0, burnAlert = 1 } = {}) {
  const cutoff = now - windowMs;
  const win = events.filter((e) => (Number(e.ts_ms ?? Date.parse(e.ts)) || 0) >= cutoff);
  const total = win.length;
  if (total === 0) return { window: total, sli: 1, errorRate: 0, errorBudget: 1 - target, errorBudgetRemaining: 1, burnRate: 0, alert: false };
  const errRate = win.filter(isError).length / total;
  const sli = 1 - errRate;
  const budget = 1 - target;
  const burnRate = budget === 0 ? (errRate > 0 ? Infinity : 0) : errRate / budget;
  return {
    window: total,
    sli,
    errorRate: errRate,
    errorBudget: budget,
    errorBudgetRemaining: Math.max(0, 1 - errRate / budget),
    burnRate,
    alert: burnRate > burnAlert,
  };
}
