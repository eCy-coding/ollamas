// mission (pure) — turn the fleet's PARALLEL slot-plan into a SEQUENCED, dependency-ordered, ethically
// bounded mission (T1→Tn). IO-free → unit-tested.
//
// Why: fleet-plan assigns models to streams but produces an UNORDERED set of parallel slots. The operator
// wants step-by-step ("adım adım") ordered tasks the council executes end-to-end while using the MacBook
// within ETHICAL BOUNDS. This module topo-sorts the streams by an explicit dependency map (foundation
// work first) and tags each step with the maximum tool-tier its work may touch — capped at "host"
// (PROPOSE + gate). "privileged" (macos_terminal / write_host_file) is NEVER auto-assigned: opening a real
// terminal or writing host files stays behind an explicit operator gate. That encodes "etik sınır içinde
// MacBook kullanımı" as data, not prose.

// Tool-tiers mirror server/tool-registry.ts (safe|host|privileged|host_upstream). Autonomous fleet steps
// only ever reach "safe" (read + new file, no existing-code edit) or "host" (propose a patch, gated apply).
export type EthicalTier = "safe" | "host";

// The canonical CODE_PLAN dependency DAG (foundation first). Shared by the mission CLI and the fleet
// sequenced-launch order so both order streams by the SAME ethical sequence. Each stream lists the
// streams that must complete BEFORE it (evidence: fleet-plan CODE_PLAN priority + operator's tab order).
export const DEFAULT_DEPS: Record<string, string[]> = {
  "shell-harden": [],                                            // foundation: safe env/exit-code first
  "mjs-migration": ["shell-harden"],                             // establish the TS base on hardened scripts
  "typescript-core": ["mjs-migration"],                          // all new logic sits on the migrated TS base
  "errors-resilience": ["typescript-core"],                      // resilience layered onto the core
  "concurrency-safety": ["typescript-core"],                     // concurrency layered onto the core
  "test-coverage": ["errors-resilience", "concurrency-safety"],  // verify everything last
};

export interface MissionStep {
  order: number;             // T1..Tn (1-based) after topological sort
  stream: string;
  task: string;              // the stream's concern (what this step accomplishes)
  models: string[];          // capability-matched models (ensemble: Terminal.app + iTerm2), ≤2/model overall
  dependsOn: string[];       // streams that must complete first
  tier: EthicalTier;         // max tool-tier this step's work may touch (never "privileged")
  gate: string;              // how the step is verified before it counts as done
}

export interface Mission {
  steps: MissionStep[];
  ok: boolean;               // topo-sort succeeded and every step has ≥1 model + a valid tier
  maxTwoOk: boolean;         // no model appears in >2 streams (the operator's hard cap)
}

/** Max tool-tier a stream's work may touch. Read-only/new-file work = "safe"; anything that edits
 *  existing code, shell, or migrates files = "host" (PROPOSE + conductor gate). Never "privileged". */
export function ethicalTier(stream: string): EthicalTier {
  // test-coverage only reads code + adds NEW test files → no existing-code mutation → safe.
  return stream === "test-coverage" ? "safe" : "host";
}

/** Kahn's algorithm: topologically order `nodes` given `deps` (node → prerequisite nodes). Deterministic
 *  (ties broken by the input order of `nodes`). Throws on a cycle or an unknown dependency (no guessing). */
export function topoSort(nodes: string[], deps: Map<string, string[]>): string[] {
  const set = new Set(nodes);
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  const dependents = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const n of nodes) {
    for (const d of deps.get(n) ?? []) {
      if (!set.has(d)) throw new Error(`unknown dependency: ${n} → ${d}`);
      indeg.set(n, (indeg.get(n) ?? 0) + 1);
      dependents.get(d)!.push(n);
    }
  }
  // Seed the queue in input order so the result is stable/deterministic.
  const queue = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const m of dependents.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if ((indeg.get(m) ?? 0) === 0) queue.push(m);
    }
  }
  if (out.length !== nodes.length) throw new Error(`dependency cycle detected among: ${nodes.filter((n) => !out.includes(n)).join(", ")}`);
  return out;
}

/** The gate a step must pass, by tier. Both are PROPOSE-only (isolated --root); "host" additionally
 *  requires the conductor to gate the patch before any apply. */
function gateFor(tier: EthicalTier): string {
  return tier === "safe"
    ? "tsc 0 + vitest green (read-only analysis + new file)"
    : "tsc 0 + vitest green + conductor gate before apply (PROPOSE-only, isolated --root)";
}

export interface AssignmentLike { stream: string; concern: string; model: string | null; }

/**
 * Build the sequenced mission from fleet assignments + an explicit dependency map. One step per stream
 * (the two app-slots are the step's ensemble models). Streams are topo-ordered so foundational work runs
 * first. ≤2/model is preserved from the assignments (surfaced via maxTwoOk).
 */
export function buildMission(assignments: AssignmentLike[], depMap: Map<string, string[]>): Mission {
  // Group assignments by stream, preserving first-seen order; collect distinct resolved models.
  const byStream = new Map<string, { concern: string; models: string[] }>();
  for (const a of assignments) {
    const e = byStream.get(a.stream) ?? { concern: a.concern, models: [] };
    if (a.model && !e.models.includes(a.model)) e.models.push(a.model);
    byStream.set(a.stream, e);
  }
  const streams = [...byStream.keys()];
  // Only keep deps that point at streams present in the plan (a dep on an absent stream is a hard error
  // handled by topoSort; we pass the map through unchanged so cycles/unknowns are caught, not hidden).
  const ordered = topoSort(streams, depMap);

  const steps: MissionStep[] = ordered.map((stream, i) => {
    const e = byStream.get(stream)!;
    const tier = ethicalTier(stream);
    return {
      order: i + 1,
      stream,
      task: e.concern,
      models: e.models,
      dependsOn: (depMap.get(stream) ?? []).filter((d) => byStream.has(d)),
      tier,
      gate: gateFor(tier),
    };
  });

  // ≤2/model over the whole mission (the operator's hard cap: a model in ≤2 streams).
  const usage = new Map<string, Set<string>>();
  for (const s of steps) for (const m of s.models) {
    if (!usage.has(m)) usage.set(m, new Set());
    usage.get(m)!.add(s.stream);
  }
  const maxTwoOk = [...usage.values()].every((set) => set.size <= 2);
  const ok = steps.length === streams.length && steps.every((s) => s.models.length > 0 && (s.tier === "safe" || s.tier === "host"));
  return { steps, ok, maxTwoOk };
}

/** Render the mission as an ordered, operator-readable checklist (MISSION.md body). */
export function renderMission(m: Mission, ts: string): string {
  const L = [
    `# MISSION.md — sequenced ethical mission (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/mission.ts\` · ${ts}. Step-by-step (T1→Tn) dependency-ordered tasks the`,
    `> council executes end-to-end. Each step is PROPOSE-only (isolated --root) and capped at the shown`,
    `> tool-tier — \`privileged\` (open a real terminal / write host files) is NEVER auto-assigned; it stays`,
    `> behind an explicit operator gate. ≤2 streams/model. Map: \`.claude/BRAIN.md\`.`,
    ``,
    `## Status: ${m.ok ? "✅ valid sequence" : "⚠️ invalid"} · ≤2/model ${m.maxTwoOk ? "✅" : "⚠️ VIOLATED"}`,
    ``,
    `| T | Stream | Task | Models (≤2/model) | Depends on | Ethical tier | Gate |`,
    `|---|--------|------|-------------------|------------|--------------|------|`,
  ];
  for (const s of m.steps) {
    L.push(`| T${s.order} | ${s.stream} | ${s.task} | ${s.models.join(", ") || "—"} | ${s.dependsOn.join(", ") || "—"} | \`${s.tier}\` | ${s.gate} |`);
  }
  L.push(
    ``,
    `## Ethical bounds (encoded, not prose)`,
    `- Every step runs a PROPOSE-only worker in an isolated \`--root\` — it never mutates the real repo tree.`,
    `- \`safe\` = read + new file only. \`host\` = propose a patch; the conductor gates (tsc+vitest) before apply.`,
    `- \`privileged\` (macos_terminal, write_host_file) is absent by design → no autonomous terminal/host-file use.`,
    `- The conductor (Claude) directs; workers report to the conductor, never to the operator.`,
  );
  return L.join("\n");
}
