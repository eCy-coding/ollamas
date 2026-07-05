/**
 * orchestration/bin/lib/task-catalog.ts — PURE task→target resolver for `ollamas do "<task>"` (iter-6).
 *
 * Today the conductor could only ground a REPAIR on the 6-entry FOCUS map (lib/fleet-prompt); an arbitrary
 * task grounded on the WRONG file. The 100-task catalog (orchestration/TASKS_100.json) gives every critical
 * task its OWN real target file + concrete goal, so `ollamas do "<id|description>"` resolves deterministically
 * to the right file and produces an apply-ready grounded proposal. No IO here → fully unit-testable.
 */

export interface Task {
  id: string;        // stable kebab-case id, e.g. "backend-analyzer-guard"
  lane: string;      // backend | frontend | cli | scripts | orchestration | contract | tunnel | tests | …
  target: string;    // repo-relative path to a REAL existing file
  goal: string;      // one concrete, small, additive, behavior-preserving change
  acceptance?: string;
}

function tokens(s: string): string[] {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

/**
 * Resolve a free-text query to a catalog task. Precedence: exact id → id substring (either direction) →
 * best token-overlap over id+target+goal. Returns null when nothing plausibly matches (caller degrades
 * gracefully — never crashes). Deterministic.
 */
export function resolveTask(query: string, catalog: Task[]): Task | null {
  const list = Array.isArray(catalog) ? catalog : [];
  const q = String(query || "").trim().toLowerCase();
  if (!q || !list.length) return null;

  const exact = list.find((t) => t.id.toLowerCase() === q);
  if (exact) return exact;

  const sub = list.find((t) => q.includes(t.id.toLowerCase()) || t.id.toLowerCase().includes(q));
  if (sub) return sub;

  const qt = new Set(tokens(q));
  if (!qt.size) return null;
  let best: Task | null = null;
  let bestScore = 0;
  for (const t of list) {
    const tt = new Set(tokens(`${t.id} ${t.target} ${t.goal}`));
    const overlap = [...qt].filter((x) => tt.has(x)).length;
    if (overlap > bestScore) { bestScore = overlap; best = t; }
  }
  return bestScore >= 1 ? best : null;
}

/** Structural validation of a parsed catalog blob (used by the integrity test). Returns the reasons a row is bad. */
export function catalogRowErrors(t: unknown): string[] {
  const errs: string[] = [];
  const o = (t ?? {}) as Record<string, unknown>;
  for (const k of ["id", "lane", "target", "goal"]) {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) errs.push(`missing/empty ${k}`);
  }
  return errs;
}

/** Duplicate-id detector (catalog must have 100 UNIQUE ids). */
export function duplicateIds(catalog: Task[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const t of catalog) {
    if (seen.has(t.id)) dups.add(t.id);
    seen.add(t.id);
  }
  return [...dups];
}
