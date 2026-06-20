// Scripts-as-SaaS metering core (scripts lane, v11) — PURE, no fs/network.
// Turns the host-local seyir event stream into a per-tool COST/usage meter:
// billable units = Σ tier-weight per call, est. cost = units × rate.
//
// SCOPE NOTE: these are HOST-LOCAL operational cost figures. Multi-tenant billing
// (Stripe metered usage) is the integrations lane's job — server/tool-registry
// execute() → store.recordUsage → billing/stripe, keyed by tenantId. Host-bridge
// events carry NO tenant, so this NEVER double-counts tenant billing (RISK-SCR-013).
//
// Adopts the openmeterio/openmeter (Apache) meter shape (SUM aggregation per tool,
// period rollup) and the AgentOps-AI/tokencost (MIT) per-unit rate-map idea — as
// patterns, reimplemented zero-dep.

// Default cost weights: host-exec is pricier than a safe read; reflects real risk/cost.
export const DEFAULT_TIER_WEIGHTS = { safe: 1, host: 3, privileged: 10, host_upstream: 5 };

const isError = (e) => e.status === "error" || e.exit !== 0;

// "YYYY-MM" period key for an event (UTC), from ts_ms or ts.
export function periodOf(e) {
  const ms = Number(e.ts_ms ?? Date.parse(e.ts)) || 0;
  return new Date(ms).toISOString().slice(0, 7);
}

// Keep only events in a given "YYYY-MM" month (null = all).
export function filterPeriod(events = [], month = null) {
  if (!month) return events;
  return events.filter((e) => periodOf(e) === month);
}

// Meter events → per-tool { count, errors, billableUnits, estCost } + totals.
// toolTier maps tool name -> tier (from inventory.json). Unknown tool → "safe".
export function meter(events = [], {
  toolTier = {},
  tierWeights = DEFAULT_TIER_WEIGHTS,
  rate = 0,
  budget = null,
  period = null,
} = {}) {
  const byTool = {};
  for (const e of events) {
    const tool = e.tool || "unknown";
    const tier = toolTier[tool] || "safe";
    const w = tierWeights[tier] ?? 1;
    const b = (byTool[tool] ||= { tool, tier, count: 0, errors: 0, billableUnits: 0, estCost: 0 });
    b.count++;
    if (isError(e)) b.errors++;
    b.billableUnits += w;
  }
  for (const b of Object.values(byTool)) b.estCost = round2(b.billableUnits * rate);

  const billableUnits = Object.values(byTool).reduce((a, b) => a + b.billableUnits, 0);
  const errors = Object.values(byTool).reduce((a, b) => a + b.errors, 0);
  const totals = { calls: events.length, errors, billableUnits, estCost: round2(billableUnits * rate) };
  return {
    period,
    rate,
    budget,
    overBudget: budget != null && totals.estCost > budget,
    byTool,
    totals,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
