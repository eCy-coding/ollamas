// build-plan (pure) — turn the completion-gap report (COMPLETION_GAPS) into a step-by-step, section-by-
// section build PLAN: dependency-ordered phases (one per owning fleet stream, ordered by DEFAULT_DEPS),
// gaps within a phase ordered by severity, each attached to a fast/safe/correct build recipe. IO-free →
// unit-tested; the CLI reads the JSON and writes BUILD_PLAN.md. This is a PLAN — it builds nothing.

import { topoSort, DEFAULT_DEPS } from "./mission";

export type GapKind = "language-migration" | "route-missing" | "route-unused" | "stub" | "sparse-folder";
export type Severity = "P1" | "P2" | "P3";

export interface GapLike {
  kind: GapKind;
  title: string;
  severity: Severity;
  ownerStream: string;
  justification: string;
  evidence: string;
}

export interface Recipe { approach: string; steps: string[]; verify: string }

// The fast / safe / correct build recipe per gap kind. Security-first, behavior-preserving, test-first;
// false-positive-aware (verify route/stub reality before implementing; never fabricate for a placeholder).
export const RECIPE: Record<GapKind, Recipe> = {
  "language-migration": {
    approach: "IN-PLACE type-safety first — most .mjs are node-executed entry-points (`node x.mjs`), so a rename would break the zero-build runtime. Add types without renaming; only truly tsx-imported .mjs may later rename.",
    steps: [
      "Per file (batch by directory, leaf first): add `// @ts-check` at the top + JSDoc `@param`/`@returns` on functions — comments/types ONLY, runtime logic IDENTICAL, the file keeps running under `node`.",
      "Gate: `tsc -p scripts/tsconfig.json --noEmit` clean (the file is now type-checked in place) + its test / the full suite still green.",
      "Do NOT rename a shebang/`node x.mjs` entry-point to .ts (node can't run .ts without tsx/build — it breaks the invocation).",
      "Only after in-place type-safety, a .mjs that is IMPORTED by tsx (never node-executed) MAY be renamed .ts + its importers updated + re-gated.",
    ],
    verify: "tsc -p scripts/tsconfig.json 0 + full suite green + the .mjs still runs under `node` (zero behavior diff, no broken invocation).",
  },
  "route-missing": {
    approach: "Verify the call is REAL before implementing — some are URL-concat regex artifacts.",
    steps: [
      "Open the frontend source line: is it a genuine endpoint or a base-URL concatenation artifact?",
      "If real: implement the Express handler in server/** reusing an adjacent handler pattern, with input validation + typed body + error handling.",
      "If artifact: fix the frontend call (correct the constructed URL); no backend change.",
      "Add a test (request → expected status/shape) and register the route at the choke-point.",
    ],
    verify: "New route returns the expected status for valid + invalid input; test green; no 404 for the real call.",
  },
  "route-unused": {
    approach: "Confirm intent before touching — a dead-looking route may be a public/webhook/CLI API.",
    steps: [
      "Grep for EXTERNAL callers (docs, tests, mcp clients, curl recipes, CI) — not just the frontend.",
      "If it's a public/webhook/CLI API: KEEP it and document it (OpenAPI / README note).",
      "If genuinely dead (no consumer anywhere): remove the route + its handler + tests.",
    ],
    verify: "Either documented as intentional, or removed with the suite still green; never removed without confirming no consumer.",
  },
  "stub": {
    approach: "Read the marker context first — some are grep-arg false positives (the literal word TODO in code).",
    steps: [
      "Open the file at the marker: is it real unfinished logic or an incidental occurrence of TODO/FIXME?",
      "If real: implement the flagged logic, smallest correct change, with a test.",
      "If false positive: no action (the scanner honestly flags it as 'found in file').",
    ],
    verify: "Marker resolved (implemented + tested) or confirmed a false positive; no dangling unfinished logic.",
  },
  "sparse-folder": {
    approach: "Verify intent — a near-empty folder is a placeholder OR an unfinished lane. Never fabricate code.",
    steps: [
      "Inspect the folder + git history: is it an intentional placeholder (assets/tokens) or an unfinished lane?",
      "If intentional: add a short README explaining its purpose so it isn't mistaken for a gap.",
      "If unfinished: scope its completion as a separate, properly-planned lane (don't inline-guess its contents).",
    ],
    verify: "Folder either documented as intentional, or a real completion lane is scoped — no invented placeholder code.",
  },
};

const sevRank: Record<Severity, number> = { P1: 0, P2: 1, P3: 2 };

export interface PlanStep { gap: GapLike; recipe: Recipe }
export interface Phase { order: number; stream: string; steps: PlanStep[]; p1: number }

/** Order the present owner-streams by the canonical DEFAULT_DEPS dependency DAG (foundation first). Streams
 *  absent from the DAG sort last, stable. Avoids topoSort's unknown-dependency throw by sorting the FULL DAG
 *  then filtering to the present set. */
export function orderStreams(present: string[]): string[] {
  const all = Object.keys(DEFAULT_DEPS);
  const full = topoSort(all, new Map(Object.entries(DEFAULT_DEPS)));
  const inDag = full.filter((s) => present.includes(s));
  const outside = present.filter((s) => !all.includes(s)); // keep unknown streams, last, input order
  return [...inDag, ...outside];
}

/** Build the ordered, sectioned plan: one phase per owner-stream (dependency order), gaps by severity. */
export function buildPlan(gaps: GapLike[]): Phase[] {
  const byStream = new Map<string, GapLike[]>();
  for (const g of gaps) { if (!byStream.has(g.ownerStream)) byStream.set(g.ownerStream, []); byStream.get(g.ownerStream)!.push(g); }
  const ordered = orderStreams([...byStream.keys()]);
  return ordered.map((stream, i) => {
    const streamGaps = [...(byStream.get(stream) ?? [])].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
    return {
      order: i + 1,
      stream,
      steps: streamGaps.map((gap) => ({ gap, recipe: RECIPE[gap.kind] })),
      p1: streamGaps.filter((g) => g.severity === "P1").length,
    };
  });
}

/** Render BUILD_PLAN.md — step-by-step, section-by-section, each gap with its fast/safe/correct recipe. */
export function renderBuildPlan(phases: Phase[], ts: string): string {
  const totalSteps = phases.reduce((n, p) => n + p.steps.length, 0);
  const p1 = phases.reduce((n, p) => n + p.p1, 0);
  const L: string[] = [
    `# BUILD_PLAN.md — how to build the missing code, step by step (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/build-plan.ts\` · ${ts}. Turns COMPLETION_GAPS into an ordered build plan:`,
    `> phases run in fleet-stream dependency order (foundation first), gaps within a phase by severity, each`,
    `> with a fast / safe / correct recipe. Fastest = reuse adjacent patterns + batch; Safest = verify-before-touch,`,
    `> behavior-preserving, test-first; Correct = typed + gated each step. This is a PLAN — it builds nothing.`,
    ``,
    `## Overview: ${phases.length} phase(s) · ${totalSteps} step(s) · ${p1} P1`,
    ...phases.map((p) => `- T${p.order} — \`${p.stream}\` (${p.steps.length} step${p.steps.length === 1 ? "" : "s"}${p.p1 ? `, ${p.p1} P1` : ""})`),
    ``,
  ];
  for (const p of phases) {
    L.push(`## T${p.order} — Section: \`${p.stream}\``, ``);
    p.steps.forEach((s, i) => {
      L.push(
        `### T${p.order}.${i + 1} · [${s.gap.severity}] ${s.gap.title}`,
        `- **Why:** ${s.gap.justification}`,
        `- **Evidence:** ${s.gap.evidence}`,
        `- **Approach (fast/safe/correct):** ${s.recipe.approach}`,
        ...s.recipe.steps.map((step, k) => `  ${k + 1}. ${step}`),
        `- **Verify:** ${s.recipe.verify}`,
        ``,
      );
    });
  }
  L.push(
    `## Sequence rationale`,
    `- Phases follow the fleet dependency DAG (DEFAULT_DEPS): shell-harden → mjs-migration → typescript-core →`,
    `  {errors-resilience, concurrency-safety} → test-coverage. Migration establishes the TS base before new`,
    `  logic; resilience layers on the core; tests verify last. Within a phase, P1 before P2 before P3.`,
    `- Each step is gated (tsc + tests) before the next — no half-work, no big-bang.`,
  );
  return L.join("\n");
}
