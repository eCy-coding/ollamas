// fleet-plan (pure) — assign CODE_PLAN work-streams to capability-matched models across the two
// terminal apps (Terminal.app + iTerm2), honoring the hard constraint: EACH MODEL IN ≤2 STREAMS.
//
// Why 2 apps per stream: Terminal.app slot + iTerm2 slot run the SAME stream with DIFFERENT models →
// a best-of-2 ensemble (cross-check → fewer errors), not a wasted copy.
//
// Single-GPU truth (the MacBook has one GPU): two LOCAL models cannot run at once. The plan tags each
// slot local|cloud so the launcher/conductor can keep ≤1 local active (cloud parallelizes freely);
// runtime serialization is enforced by the claims ledger, not here. This module is IO-free → unit-tested.

export type Slot = "terminal" | "iterm2";

export interface StreamSpec {
  id: string;
  lang: string;               // primary language of the work
  concern: string;            // CODE_PLAN theme
  // ordered model preference (strongest/most-suitable first); cloud tags parallelize on the single GPU
  prefer: string[];
}

export interface Assignment {
  stream: string;
  lang: string;
  concern: string;
  slot: Slot;
  app: "Terminal.app" | "iTerm2";
  model: string | null;       // resolved model, or null if none available under the ≤2 cap
  runtime: "local" | "cloud" | "unknown";
}

export interface FleetPlan {
  assignments: Assignment[];
  perModel: { model: string; streams: string[] }[];  // usage (must be ≤2 each)
  maxTwoOk: boolean;
  localSlots: number;         // slots that would use the single GPU (must serialize)
  cloudSlots: number;         // parallelizable
  unassigned: { stream: string; slot: Slot }[];
}

// The work-streams (CODE_PLAN themes + Emre's explicit language tabs). Ordered by CODE_PLAN priority.
// `provider::model` tail entries are FREE-tier API workers (server PROVIDER_CATALOG),
// key-gated: they resolve only when the provider's key is live (readyApiProviders) and
// never outrank a proven ollama seat. Zero keys → plans identical to the legacy ones.
export const STREAMS: StreamSpec[] = [
  { id: "typescript-core", lang: "TypeScript", concern: "security+types (all new logic)",
    prefer: ["qwen3-coder:480b-cloud", "qwen3-coder:30b", "qwen3-coder-64k:latest", "zai::glm-4.7-flash"] },
  { id: "errors-resilience", lang: "TypeScript", concern: "error-handling + exit-code + logging",
    prefer: ["qwen3-coder:480b-cloud", "deepseek-r1:32b", "gpt-oss:120b-cloud", "gemini-2.5-flash", "groq::llama-3.3-70b-versatile"] },
  { id: "concurrency-safety", lang: "TypeScript", concern: "race-condition + synchronization",
    prefer: ["deepseek-r1:32b", "gpt-oss:120b-cloud", "llama3.3:70b", "cerebras::gpt-oss-120b"] },
  { id: "mjs-migration", lang: "JavaScript→TypeScript", concern: "type-safety (.mjs → .ts, 490 files)",
    prefer: ["qwen3-coder-64k:latest", "gpt-oss:120b-cloud", "qwen3-coder:30b", "zai::glm-4.7-flash"] },
  { id: "shell-harden", lang: "Shell", concern: "env-guard + exit-code hardening",
    prefer: ["qwen3:8b", "gpt-oss:20b-cloud", "phi4:latest", "groq::llama-3.3-70b-versatile"] },
  { id: "test-coverage", lang: "TypeScript", concern: "vitest coverage",
    prefer: ["qwen3:8b", "qwen3-coder:30b", "gpt-oss:20b-cloud", "cerebras::gpt-oss-120b"] },
];

/** A model tag is "cloud" (parallelizes; costs no local GPU) when it carries the -cloud suffix OR is a remote
 *  vendor like Gemini. Only bare ollama tags are "local" (the single GPU that must serialize). */
export function runtimeOf(model: string | null): Assignment["runtime"] {
  if (!model) return "unknown";
  if (model.includes("::")) return "cloud"; // provider::model API workers parallelize, no GPU ticket
  if (/^gemini[-.\d]/i.test(model)) return "cloud";
  return /-cloud\b|:cloud\b|cloud$/.test(model) ? "cloud" : "local";
}

/**
 * Assign 2 distinct models per stream (Terminal.app + iTerm2) with a hard ≤2-streams-per-model cap.
 * Greedy over each stream's preference list; a slot that cannot be filled under the cap is left null
 * and surfaced in `unassigned` (never silently dropped). Prefers a cloud model for the first slot so
 * at most one local model is needed per stream (single-GPU friendliness).
 */
export function buildFleetPlan(availableModels: string[], readyApiProviders: string[] = []): FleetPlan {
  const avail = new Set((availableModels ?? []).map((m) => String(m).trim()).filter(Boolean));
  const readyApi = new Set((readyApiProviders ?? []).map((p) => String(p).trim()).filter(Boolean));
  // A prefer entry is usable when it is a pulled ollama tag OR a `provider::model` API
  // worker whose provider has a live key (/api/keys/pool → fleet-launch/mission feed it).
  const usable = (m: string) => {
    const i = m.indexOf("::");
    return i > 0 ? readyApi.has(m.slice(0, i)) : avail.has(m);
  };
  const usage = new Map<string, string[]>(); // model → streams assigned
  const use = (m: string) => (usage.get(m) ?? []).length;
  const assignments: Assignment[] = [];
  const unassigned: { stream: string; slot: Slot }[] = [];

  for (const s of STREAMS) {
    // slot0 (Terminal.app) prefers CLOUD (spares the single GPU); slot1 (iTerm2) prefers LOCAL, so
    // each stream is 1 cloud + 1 local — cloud spreads across all streams instead of starving late ones.
    const pick = (exclude: string | null, want: "cloud" | "local"): string | null => {
      const pool = s.prefer.filter((m) => usable(m) && use(m) < 2 && m !== exclude);
      return pool.find((m) => runtimeOf(m) === want) ?? pool[0] ?? null;
    };
    const m0 = pick(null, "cloud");
    if (m0) usage.set(m0, [...(usage.get(m0) ?? []), s.id]);
    const m1 = pick(m0, "local");
    if (m1) usage.set(m1, [...(usage.get(m1) ?? []), s.id]);

    for (const [slot, app, model] of [
      ["terminal", "Terminal.app", m0], ["iterm2", "iTerm2", m1],
    ] as [Slot, Assignment["app"], string | null][]) {
      if (!model) unassigned.push({ stream: s.id, slot });
      assignments.push({ stream: s.id, lang: s.lang, concern: s.concern, slot, app, model, runtime: runtimeOf(model) });
    }
  }

  const perModel = [...usage.entries()].map(([model, streams]) => ({ model, streams })).sort((a, b) => a.model.localeCompare(b.model));
  const maxTwoOk = perModel.every((p) => p.streams.length <= 2);
  const localSlots = assignments.filter((a) => a.runtime === "local").length;
  const cloudSlots = assignments.filter((a) => a.runtime === "cloud").length;
  return { assignments, perModel, maxTwoOk, localSlots, cloudSlots, unassigned };
}

/** Guard: throws if any model exceeds 2 streams (invariant the user set). */
export function assertMaxTwo(plan: FleetPlan): void {
  const over = plan.perModel.filter((p) => p.streams.length > 2);
  if (over.length) throw new Error(`≤2-görev ihlali: ${over.map((o) => `${o.model}=${o.streams.length}`).join(", ")}`);
}
