/**
 * orchestration/bin/lib/organization.ts — PURE management/organization engine.
 *
 * The deterministic heart of the unified management layer (ORGANIZATION.md): parse the org chart
 * (ORG_CHART.json + council seats merged from COUNCIL_ROSTER.json), assign every task to the CHEAPEST
 * capable actor, consult the error registries so a registered mistake is never dispatched again, build
 * the worker brief with a verbatim NEVER-REPEAT block, and record every outcome as a ledger entry
 * (failure → registry-append proposal with a prevention_rule).
 *
 * Same discipline as hierarchy.ts/orchestra-fsm.ts: no sockets, no disk, no clocks — `ts` is injected.
 * IO lives in org-io.ts; the brain adapter in brain-ledger.ts.
 */

export interface KnownFault { id: string; note: string; }

export interface Actor {
  id: string;
  kind: "operator" | "service" | "cli" | "model" | "pool";
  role: string;
  duties: string[];
  capabilities: string[];
  reportsTo: string | null;
  escalatesTo: string | null;
  endpoint?: string;
  model?: string;
  /** 0=free-local, 1=free-cloud, 2=external-service, 3=paid — routing prefers the lowest. */
  costRank: number;
  knownFaults: KnownFault[];
}

export interface OrgChart {
  version: number;
  ts: string;
  actors: Actor[];
}

export interface TaskSpec {
  id: string;
  goal: string;
  /** Primary routing class (matched against actor capabilities), e.g. "code" | "vision" | "research". */
  cls: string;
  /** Extra keywords for error-registry matching (target path, lane, free text). */
  tags?: string[];
}

export interface Assignment {
  actorId: string;
  model?: string;
  costRank: number;
  reason: "capability-match" | "escalate-no-capable";
  escalatesTo: string | null;
  knownFaults: KnownFault[];
}

/** One normalized entry from ANY error-registry shape (errors_registry / PROBLEM_REGISTRY / knownFaults). */
export interface PreventionRule {
  id: string;
  source: string;
  /** Searchable text of the entry (root cause / note / pattern). */
  text: string;
  /** The one-sentence rule injected verbatim into the worker brief. */
  rule: string;
}

export interface DispatchOutcome {
  taskId: string;
  actorId: string;
  ok: boolean;
  summary: string;
  ts: string;
  error?: string;
  durationMs?: number;
}

export interface LedgerEntry {
  type: "dispatch" | "outcome";
  tier: "episodic" | "learned";
  ts: string;
  taskId: string;
  actorId: string;
  ok?: boolean;
  summary: string;
  rulesApplied?: string[];
}

/** PROPOSE-mode error-registry append (written as a proposal file, gated — never a direct mutation). */
export interface ErrorEntryProposal {
  id: string;
  ts: string;
  file: string;
  category: string;
  severity: "CRITICAL" | "high" | "med";
  root_cause: string;
  evidence: string;
  prevention_rule: string;
  recurrence_count: 0;
}

const VALID_KINDS: ReadonlySet<string> = new Set(["operator", "service", "cli", "model", "pool"]);

function isStr(v: unknown): v is string { return typeof v === "string" && v.trim() !== ""; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.filter(isStr) : []; }

/**
 * Validate untrusted JSON into an OrgChart. THROWS with a distinct message per violation
 * (same contract style as hierarchy.ts parsePolicy — degenerate data must never route real work).
 */
export function parseOrgChart(json: unknown): OrgChart {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("parseOrgChart: chart must be an object");
  }
  const c = json as Record<string, unknown>;
  if (typeof c.version !== "number" || !Number.isFinite(c.version)) {
    throw new Error("parseOrgChart: version must be a finite number");
  }
  if (typeof c.ts !== "string" || Number.isNaN(Date.parse(c.ts))) {
    throw new Error("parseOrgChart: ts must be a parseable date string");
  }
  const actors = c.actors;
  if (!Array.isArray(actors) || actors.length === 0) {
    throw new Error("parseOrgChart: actors must be a non-empty array");
  }
  const seen = new Set<string>();
  const parsed: Actor[] = actors.map((a, i) => {
    if (a === null || typeof a !== "object" || Array.isArray(a)) {
      throw new Error(`parseOrgChart: actor[${i}] must be an object`);
    }
    const r = a as Record<string, unknown>;
    if (!isStr(r.id)) throw new Error(`parseOrgChart: actor[${i}].id must be a non-empty string`);
    if (seen.has(r.id)) throw new Error(`parseOrgChart: duplicate actor id "${r.id}"`);
    seen.add(r.id);
    if (!isStr(r.kind) || !VALID_KINDS.has(r.kind)) {
      throw new Error(`parseOrgChart: actor "${r.id}" kind must be one of operator|service|cli|model|pool`);
    }
    if (!isStr(r.role)) throw new Error(`parseOrgChart: actor "${r.id}" role must be a non-empty string`);
    const capabilities = strArr(r.capabilities);
    if (capabilities.length === 0) {
      throw new Error(`parseOrgChart: actor "${r.id}" must declare at least one capability`);
    }
    if (typeof r.costRank !== "number" || !Number.isFinite(r.costRank) || r.costRank < 0) {
      throw new Error(`parseOrgChart: actor "${r.id}" costRank must be a finite number >= 0`);
    }
    const faults = Array.isArray(r.knownFaults)
      ? (r.knownFaults as unknown[]).flatMap((f): KnownFault[] => {
          const kf = f as Record<string, unknown>;
          return kf && isStr(kf.id) && isStr(kf.note) ? [{ id: kf.id, note: kf.note }] : [];
        })
      : [];
    return {
      id: r.id, kind: r.kind as Actor["kind"], role: r.role,
      duties: strArr(r.duties), capabilities,
      reportsTo: isStr(r.reportsTo) ? r.reportsTo : null,
      escalatesTo: isStr(r.escalatesTo) ? r.escalatesTo : null,
      endpoint: isStr(r.endpoint) ? r.endpoint : undefined,
      model: isStr(r.model) ? r.model : undefined,
      costRank: r.costRank, knownFaults: faults,
    };
  });
  // Reporting lines must resolve — a dangling reportsTo/escalatesTo is a broken chain of command.
  for (const a of parsed) {
    for (const ref of [a.reportsTo, a.escalatesTo]) {
      if (ref !== null && !seen.has(ref)) {
        throw new Error(`parseOrgChart: actor "${a.id}" references unknown actor "${ref}"`);
      }
    }
  }
  return { version: c.version, ts: c.ts, actors: parsed };
}

/** Roster seat shape (subset of COUNCIL_ROSTER.json we consume). */
export interface RosterSeat { capability: string; role: string; model: string; available?: boolean; responsibility?: string; }

/**
 * Merge council roster seats into the chart as model actors (id `seat:<capability>`), skipping models
 * already present as structural actors. The roster stays the single source of truth for seats — this is
 * a load-time view, never a copy on disk.
 */
export function mergeRosterSeats(chart: OrgChart, seats: RosterSeat[]): OrgChart {
  const knownModels = new Set(chart.actors.map((a) => a.model).filter(Boolean));
  const merged: Actor[] = seats
    .filter((s) => isStr(s.capability) && isStr(s.model) && s.available !== false && !knownModels.has(s.model))
    .map((s) => ({
      id: `seat:${s.capability}`,
      kind: "model" as const,
      role: `Council seat — ${s.role}: ${s.responsibility ?? s.capability}`,
      duties: [s.responsibility ?? s.capability],
      capabilities: [s.capability, s.role],
      reportsTo: "conductor",
      escalatesTo: "conductor",
      model: s.model,
      costRank: s.model.includes("cloud") ? 1 : 0,
      knownFaults: [],
    }));
  return { ...chart, actors: [...chart.actors, ...merged] };
}

/**
 * Assign a task to the CHEAPEST capable actor: capability match on task.cls (exact tag), then costRank
 * ascending, then chart order (stable). Operators are never auto-assigned (T0 is a human).
 * No capable actor → escalate: route to the conductor if present, else the first non-operator actor,
 * with reason "escalate-no-capable" so callers surface it instead of silently guessing.
 */
export function assignRole(chart: OrgChart, task: TaskSpec): Assignment {
  const candidates = chart.actors
    .filter((a) => a.kind !== "operator" && a.capabilities.includes(task.cls))
    .sort((x, y) => x.costRank - y.costRank);
  const pick = candidates[0];
  if (pick) {
    return {
      actorId: pick.id, model: pick.model, costRank: pick.costRank,
      reason: "capability-match", escalatesTo: pick.escalatesTo, knownFaults: pick.knownFaults,
    };
  }
  const fallback = chart.actors.find((a) => a.id === "conductor") ?? chart.actors.find((a) => a.kind !== "operator");
  if (!fallback) throw new Error(`assignRole: no dispatchable actor in chart for class "${task.cls}"`);
  return {
    actorId: fallback.id, model: fallback.model, costRank: fallback.costRank,
    reason: "escalate-no-capable", escalatesTo: fallback.escalatesTo, knownFaults: fallback.knownFaults,
  };
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "for", "on", "with", "is", "be", "not"]);

/** Lowercase word tokens (>=3 chars, stopwords removed) — shared by consultErrors scoring. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9ğüşıöç:_./-]+/i).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Consult the normalized error knowledge (registries + the assignee's knownFaults) for entries relevant
 * to this task. Relevance = token overlap between the task text (goal+tags+cls) and the entry text;
 * every hit's `rule` is MANDATORY brief input. Deterministic, ordered by score desc then id.
 */
export function consultErrors(rules: PreventionRule[], task: TaskSpec, minOverlap = 2): PreventionRule[] {
  const taskTokens = new Set(tokenize([task.goal, task.cls, ...(task.tags ?? [])].join(" ")));
  const scored = rules
    .map((r) => {
      const overlap = tokenize(`${r.text} ${r.rule}`).filter((t) => taskTokens.has(t));
      return { r, score: new Set(overlap).size };
    })
    .filter((s) => s.score >= minOverlap)
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
  return scored.map((s) => s.r);
}

/** Actor knownFaults as PreventionRules so consultErrors treats them uniformly. */
export function faultsAsRules(a: Assignment): PreventionRule[] {
  return a.knownFaults.map((f) => ({ id: f.id, source: `actor:${a.actorId}`, text: f.note, rule: f.note }));
}

/**
 * Build the worker brief: role header + goal + a verbatim NEVER-REPEAT block. The rules are quoted
 * exactly (no paraphrase) — the brief is the enforcement surface of law #5/#7 (ORGANIZATION.md).
 */
export function buildDispatchPrompt(chart: OrgChart, a: Assignment, task: TaskSpec, rules: PreventionRule[]): string {
  const actor = chart.actors.find((x) => x.id === a.actorId);
  const duties = actor?.duties.map((d) => `- ${d}`).join("\n") ?? "";
  const never = rules.length
    ? ["## NEVER REPEAT (prevention rules — violating any of these is a defect)",
       ...rules.map((r) => `- [${r.id}] ${r.rule}`)].join("\n")
    : "## NEVER REPEAT\n- (no matching registered errors for this task)";
  return [
    `# ROLE: ${actor?.role ?? a.actorId}`,
    duties ? `## DUTIES\n${duties}` : "",
    `## TASK ${task.id}\n${task.goal}`,
    never,
    "## LAWS\n- PROPOSE, don't mutate (gates apply; red reverts)\n- Evidence before claims\n- Report blockers up the chain, never guess",
  ].filter(Boolean).join("\n\n");
}

/**
 * Turn an outcome into its ledger entry (+ a registry-append PROPOSAL on failure). Pure — the seq is
 * injected by the caller (org-io tracks it) so ids are deterministic and collision-free.
 */
export function recordOutcome(
  outcome: DispatchOutcome,
  opts: { rulesApplied: string[]; nextErrorSeq: number },
): { ledger: LedgerEntry; registryAppend?: ErrorEntryProposal } {
  const ledger: LedgerEntry = {
    type: "outcome",
    tier: outcome.ok ? "episodic" : "learned",
    ts: outcome.ts,
    taskId: outcome.taskId,
    actorId: outcome.actorId,
    ok: outcome.ok,
    summary: outcome.summary,
    rulesApplied: opts.rulesApplied,
  };
  if (outcome.ok) return { ledger };
  const id = `ERR-ORG-${String(opts.nextErrorSeq).padStart(3, "0")}`;
  return {
    ledger,
    registryAppend: {
      id,
      ts: outcome.ts,
      file: `dispatch ${outcome.taskId} → ${outcome.actorId}`,
      category: "dispatch",
      severity: "med",
      root_cause: outcome.error ?? outcome.summary,
      evidence: outcome.summary,
      prevention_rule: `Before re-dispatching "${outcome.taskId}"-class work to ${outcome.actorId}, address: ${(outcome.error ?? outcome.summary).slice(0, 160)}`,
      recurrence_count: 0,
    },
  };
}
