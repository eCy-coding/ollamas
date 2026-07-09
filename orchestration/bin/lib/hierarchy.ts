/**
 * orchestration/bin/lib/hierarchy.ts — PURE hierarchy routing engine (v1.25.3µ1).
 *
 * The conductor picks the CHEAPEST tier (local → sonnet → opus) that passes the evidence gate for a
 * given task-class. This module is the deterministic, IO-free heart: `parsePolicy` validates and rejects
 * degenerate policy data (the S0 GOTCHA — you cannot write a HIERARCHY_POLICY from benchmark rows that are
 * all-false / tok/s=0), and `resolveTierForClass` maps a class → tier using a Wilson-lower-bound gate,
 * staleness fallback, and an escalation ladder. No sockets, no disk → fully unit-testable.
 *
 * µ2 (POLICY.json) + µ3 (wire) land AFTER calibration-T0 — this file is the engine only.
 */

export type Tier = "local" | "sonnet" | "opus";

export interface Route {
  taskClass: string;
  gateSource: "scorecard" | "MODEL_SELECTION";
  wilsonLow: number;
  chosenTier: Tier;
  model: string;
  estCostUnits: number;
  reason: string;
}

export interface HierarchyPolicy {
  routes: Route[];
  gate: { wilsonFloor: number; staleDays: number };
  escalationLadder: Tier[];
  evidence: { scorecard: string; benchmarkJson: string };
  ts: string;
}

const VALID_TIERS: ReadonlySet<string> = new Set<Tier>(["local", "sonnet", "opus"]);

function isTier(v: unknown): v is Tier {
  return typeof v === "string" && VALID_TIERS.has(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate untrusted JSON into a HierarchyPolicy. THROWS on any degenerate-data condition (degenerate =
 * measurement-free / self-contradictory policy that must never route real traffic). Each failure has its
 * own distinct message so callers/tests can pin the exact violation.
 */
export function parsePolicy(json: unknown): HierarchyPolicy {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("parsePolicy: policy must be an object");
  }
  const p = json as Record<string, unknown>;

  // --- routes: non-empty array ---
  const routes = p.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error("parsePolicy: routes must be a non-empty array");
  }

  // --- gate ---
  const gate = p.gate;
  if (gate === null || typeof gate !== "object" || Array.isArray(gate)) {
    throw new Error("parsePolicy: gate must be an object");
  }
  const g = gate as Record<string, unknown>;
  if (!isFiniteNum(g.wilsonFloor)) {
    throw new Error("parsePolicy: gate.wilsonFloor must be a finite number (NaN rejected)");
  }
  const staleDays = isFiniteNum(g.staleDays) ? g.staleDays : NaN;
  if (!isFiniteNum(staleDays)) {
    throw new Error("parsePolicy: gate.staleDays must be a finite number");
  }

  // --- escalationLadder ---
  const ladder = p.escalationLadder;
  if (!Array.isArray(ladder) || ladder.length === 0 || !ladder.every(isTier)) {
    throw new Error("parsePolicy: escalationLadder must be a non-empty array of tiers");
  }
  const ladderTiers = ladder as Tier[];

  // --- evidence: scorecard is the measurement source; empty = degenerate (no measurement) ---
  const evidence = p.evidence;
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("parsePolicy: evidence must be an object");
  }
  const ev = evidence as Record<string, unknown>;
  if (typeof ev.scorecard !== "string" || ev.scorecard.trim() === "") {
    throw new Error("parsePolicy: evidence.scorecard is required and non-empty (no measurement = degenerate)");
  }
  const benchmarkJson = typeof ev.benchmarkJson === "string" ? ev.benchmarkJson : "";

  // --- ts: must be parseable ---
  if (typeof p.ts !== "string" || Number.isNaN(Date.parse(p.ts))) {
    throw new Error("parsePolicy: ts must be a parseable date string");
  }

  // --- routes: per-row validation + dup detection ---
  const seen = new Set<string>();
  const parsedRoutes: Route[] = routes.map((r, i) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      throw new Error(`parsePolicy: route[${i}] must be an object`);
    }
    const row = r as Record<string, unknown>;
    const taskClass = row.taskClass;
    if (typeof taskClass !== "string" || taskClass.trim() === "") {
      throw new Error(`parsePolicy: route[${i}].taskClass must be a non-empty string`);
    }
    if (seen.has(taskClass)) {
      throw new Error(`parsePolicy: duplicate taskClass "${taskClass}"`);
    }
    seen.add(taskClass);

    if (!isTier(row.chosenTier)) {
      throw new Error(`parsePolicy: route[${i}] chosenTier must be a valid tier`);
    }
    if (!ladderTiers.includes(row.chosenTier)) {
      throw new Error(`parsePolicy: route "${taskClass}" chosenTier "${row.chosenTier}" not in escalationLadder`);
    }
    if (!isFiniteNum(row.wilsonLow) || row.wilsonLow < 0 || row.wilsonLow > 1) {
      throw new Error(`parsePolicy: route "${taskClass}" wilsonLow must be in [0,1] (NaN rejected)`);
    }
    const gateSource = row.gateSource === "MODEL_SELECTION" ? "MODEL_SELECTION" : "scorecard";
    return {
      taskClass,
      gateSource,
      wilsonLow: row.wilsonLow,
      chosenTier: row.chosenTier,
      model: typeof row.model === "string" ? row.model : "",
      estCostUnits: isFiniteNum(row.estCostUnits) ? row.estCostUnits : 0,
      reason: typeof row.reason === "string" ? row.reason : "",
    };
  });

  return {
    routes: parsedRoutes,
    gate: { wilsonFloor: g.wilsonFloor, staleDays },
    escalationLadder: ladderTiers,
    evidence: { scorecard: ev.scorecard, benchmarkJson },
    ts: p.ts,
  };
}

/** True when `now` is more than staleDays past policy.ts. Pure — `now` is injected for determinism. */
export function isStale(ts: string, staleDays: number, now: Date): boolean {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return true;
  const ageMs = now.getTime() - t;
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}

/**
 * Resolve a task-class to a tier. Deterministic, pure. `now` is injected (no argless `new Date()`).
 * (a) unknown class → ladder[0] ("local"), reason "unknown-class-default".
 * (b) stale policy → "sonnet", reason "stale-fallback".
 * (c) wilsonLow >= gate.wilsonFloor → chosenTier, reason "gate-pass";
 *     else escalate to the tier AFTER chosenTier in the ladder (or the last tier), reason "escalate-below-floor".
 */
export function resolveTierForClass(
  policy: HierarchyPolicy,
  cls: string,
  opts?: { wilsonLow?: number; now?: Date },
): { tier: Tier; reason: string } {
  const ladder = policy.escalationLadder;
  const route = policy.routes.find((r) => r.taskClass === cls);
  if (!route) {
    return { tier: ladder[0], reason: "unknown-class-default" };
  }

  const now = opts?.now ?? new Date();
  if (isStale(policy.ts, policy.gate.staleDays, now)) {
    return { tier: "sonnet", reason: "stale-fallback" };
  }

  const wilsonLow = opts?.wilsonLow ?? route.wilsonLow;
  if (wilsonLow >= policy.gate.wilsonFloor) {
    return { tier: route.chosenTier, reason: "gate-pass" };
  }

  const idx = ladder.indexOf(route.chosenTier);
  const next = idx >= 0 && idx < ladder.length - 1 ? ladder[idx + 1] : ladder[ladder.length - 1];
  return { tier: next, reason: "escalate-below-floor" };
}
