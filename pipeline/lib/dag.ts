// DAG (pure) — the 18-step benchmark pipeline as data: parse → validate → topo-order →
// parallel batches. IO-free, so every branch is unit-tested.
//
// WHY THIS EXISTS
// The master prompt (~/Desktop/eCym.md) specifies a workflow
//   search → think → analyze → plan → todo → sandbox_test → think → analyze → test →
//   true_or_false → chaos_test → security_scan → coverage_check → code → test →
//   merge → commit → push
// and demands `"parallel": true` on every step that CAN run concurrently, "the DAG must
// respect data dependencies". The repo had no general DAG runner: `orchestration/bin/lib/
// mission.ts` topo-sorts, but against a HARD-CODED `DEFAULT_DEPS` map for the CODE_PLAN
// streams only. Its `topoSort` (Kahn, deterministic, throws on cycle/unknown) is exactly
// the primitive needed, so it is IMPORTED here rather than reimplemented.
//
// The one thing added on top: dependencies are DERIVED FROM DATA KEYS, not hand-written.
// The spec gives every step an `input: [...]` list and an `output` key; a hand-maintained
// `depends_on` beside them is a second source of truth that silently drifts (a step whose
// input key nobody produces would still "sort fine"). Here the producer of each output key
// is the authority: `deps(step) = { producer(k) | k ∈ step.input }`, merged with any
// explicit `depends_on`. A missing producer is a hard error, not a warning.
import { topoSort } from "../../orchestration/bin/lib/mission";

export interface PipelineStep {
  id: string;
  action: string;
  /** Context keys this step reads. Producers of these keys become its dependencies. */
  input?: string[] | null;
  /** Context key this step writes. Must be unique across the DAG. */
  output: string;
  /** May run concurrently with its batch peers. false ⇒ runs alone, in order. */
  parallel?: boolean;
  /** Extra edges that carry no data (e.g. chaos_test must follow the go/no-go decision). */
  depends_on?: string[];
  /** Memoise on a normalized key (see lib/cache.ts). */
  cache?: boolean;
  ttl_seconds?: number;
  parameters?: Record<string, unknown>;
}

export interface Pipeline {
  workflow_version: string;
  description?: string;
  steps: PipelineStep[];
}

/** One executable wave: every step inside it has all dependencies already satisfied. */
export interface Batch {
  level: number;
  /** Steps safe to run concurrently (all flagged `parallel: true`). */
  parallel: string[];
  /** Steps that must run one at a time, in this order, after the parallel set. */
  serial: string[];
}

export class DagError extends Error {}

/**
 * Validate structure before any ordering is attempted. Ordering errors are confusing when
 * the real problem is a typo'd key, so shape is checked first and reported with the step id.
 */
export function validate(p: Pipeline): void {
  if (!p || !Array.isArray(p.steps) || p.steps.length === 0) {
    throw new DagError("pipeline has no steps");
  }
  const ids = new Set<string>();
  const outputs = new Map<string, string>(); // output key → producing step id
  for (const s of p.steps) {
    if (!s.id) throw new DagError(`step without id (action=${s.action ?? "?"})`);
    if (!s.action) throw new DagError(`step ${s.id}: missing action`);
    if (!s.output) throw new DagError(`step ${s.id}: missing output key`);
    if (ids.has(s.id)) throw new DagError(`duplicate step id: ${s.id}`);
    // Two steps writing the same key makes "who produced this?" unanswerable, which is
    // precisely the question dependency derivation asks.
    if (outputs.has(s.output)) {
      throw new DagError(`output key '${s.output}' produced by both ${outputs.get(s.output)} and ${s.id}`);
    }
    ids.add(s.id);
    outputs.set(s.output, s.id);
  }
  for (const s of p.steps) {
    for (const k of s.input ?? []) {
      if (!outputs.has(k)) throw new DagError(`step ${s.id}: input '${k}' has no producer`);
      if (outputs.get(k) === s.id) throw new DagError(`step ${s.id}: reads its own output '${k}'`);
    }
    for (const d of s.depends_on ?? []) {
      if (!ids.has(d)) throw new DagError(`step ${s.id}: depends_on unknown step '${d}'`);
      if (d === s.id) throw new DagError(`step ${s.id}: depends on itself`);
    }
  }
}

/** step id → the step ids that must complete before it. Data keys first, explicit edges merged. */
export function deriveDeps(p: Pipeline): Map<string, string[]> {
  const producer = new Map<string, string>();
  for (const s of p.steps) producer.set(s.output, s.id);
  const deps = new Map<string, string[]>();
  for (const s of p.steps) {
    const set = new Set<string>();
    for (const k of s.input ?? []) {
      const from = producer.get(k);
      if (from && from !== s.id) set.add(from);
    }
    for (const d of s.depends_on ?? []) set.add(d);
    deps.set(s.id, [...set]);
  }
  return deps;
}

/** Deterministic execution order. Throws (never guesses) on a cycle or a dangling edge. */
export function order(p: Pipeline): string[] {
  validate(p);
  return topoSort(p.steps.map((s) => s.id), deriveDeps(p));
}

/**
 * Group the ordered steps into concurrency waves.
 *
 * A step's level is `1 + max(level of its dependencies)`, so everything in a level is
 * mutually independent and may run at once. Within a level the `parallel` flag still
 * decides: `parallel: true` steps go in one concurrent set; the rest run serially after
 * them. That distinction matters because independence is necessary but not sufficient —
 * `commit` has no data dependency on `push` yet must never race it, and the spec marks
 * exactly which steps opted in.
 */
export function batches(p: Pipeline): Batch[] {
  const ordered = order(p);
  const deps = deriveDeps(p);
  const byId = new Map(p.steps.map((s) => [s.id, s]));
  const level = new Map<string, number>();
  for (const id of ordered) {
    const ds = deps.get(id) ?? [];
    level.set(id, ds.length ? Math.max(...ds.map((d) => level.get(d) ?? 0)) + 1 : 0);
  }
  const out: Batch[] = [];
  const levels = [...new Set(ordered.map((id) => level.get(id) ?? 0))].sort((a, b) => a - b);
  for (const lv of levels) {
    const ids = ordered.filter((id) => level.get(id) === lv);
    out.push({
      level: lv,
      parallel: ids.filter((id) => byId.get(id)?.parallel === true),
      serial: ids.filter((id) => byId.get(id)?.parallel !== true),
    });
  }
  return out;
}

/**
 * How much of the DAG actually runs concurrently. `1.0` means fully serial.
 *
 * Reported because the prompt's stated goal for parallelism is throughput, and "we added a
 * parallel flag" is not evidence that anything got faster — the ratio of steps to waves is.
 */
export function parallelismFactor(p: Pipeline): number {
  const bs = batches(p);
  const steps = p.steps.length;
  const waves = bs.reduce((n, b) => n + (b.parallel.length ? 1 : 0) + b.serial.length, 0);
  return waves ? Number((steps / waves).toFixed(2)) : 1;
}

/** Human-readable plan for `--explain`; also the shape the run report embeds. */
export function explain(p: Pipeline): string[] {
  const bs = batches(p);
  const lines: string[] = [];
  for (const b of bs) {
    if (b.parallel.length) lines.push(`L${b.level} ∥ ${b.parallel.join(" , ")}`);
    for (const s of b.serial) lines.push(`L${b.level} → ${s}`);
  }
  lines.push(`steps=${p.steps.length} waves=${bs.length} parallelism=${parallelismFactor(p)}x`);
  return lines;
}
