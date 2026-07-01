#!/usr/bin/env tsx
/**
 * orchestration/bin/mission.ts — generate the SEQUENCED ethical mission (orchestration/MISSION.md).
 *
 * Reuses buildFleetPlan (capability-matched ≤2/model assignments) + an explicit dependency map, then
 * topo-orders the streams into step-by-step tasks (T1→Tn) and tags each with its ethical tool-tier.
 * This is the conductor handing the council an ordered, ethically-bounded mission — not a parallel blob.
 *
 * Run:  tsx orchestration/bin/mission.ts [--json]
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFleetPlan, assertMaxTwo, STREAMS } from "./lib/fleet-plan";
import { buildMission, renderMission, type AssignmentLike } from "./lib/mission";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const JSON_OUT = process.argv.includes("--json");

// Explicit dependency DAG (evidence: fleet-plan.ts STREAMS CODE_PLAN priority + the operator's tab order
// TS-primary → mjs→TS → shell-harden). Foundation first: harden the shell, migrate .mjs→.ts to establish
// the TS base, then build new TS logic on it, then the resilience/concurrency concerns, then verify with
// test-coverage last. Each stream lists the streams that must complete BEFORE it.
const DEPS: Record<string, string[]> = {
  "shell-harden": [],                                   // foundation: safe env/exit-code first
  "mjs-migration": ["shell-harden"],                    // establish the TS base on hardened scripts
  "typescript-core": ["mjs-migration"],                 // all new logic sits on the migrated TS base
  "errors-resilience": ["typescript-core"],             // resilience layered onto the core
  "concurrency-safety": ["typescript-core"],            // concurrency layered onto the core
  "test-coverage": ["errors-resilience", "concurrency-safety"], // verify everything last
};

/** Local models available (best-effort via `ollama list`); cloud tags always allowed. Falls back to the
 *  union of all streams' preferences so the mission is still computable offline (never empty). */
function availableModels(): string[] {
  const cloud = STREAMS.flatMap((s) => s.prefer).filter((m) => /-cloud\b|:cloud\b|cloud$/.test(m));
  let local: string[] = [];
  try {
    const out = execFileSync("ollama", ["list"], { encoding: "utf8", timeout: 8000 });
    local = out.trim().split("\n").slice(1).map((l) => l.split(/\s+/)[0]).filter(Boolean);
  } catch { local = STREAMS.flatMap((s) => s.prefer).filter((m) => !/cloud/.test(m)); }
  return [...new Set([...cloud, ...local])];
}

function nowIso(): string { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }

function main(): void {
  const plan = buildFleetPlan(availableModels());
  assertMaxTwo(plan); // hard ≤2/model guard (throws on violation — never silently ship an over-assignment)
  const assignments: AssignmentLike[] = plan.assignments.map((a) => ({ stream: a.stream, concern: a.concern, model: a.model }));
  const depMap = new Map<string, string[]>(Object.entries(DEPS));
  const mission = buildMission(assignments, depMap);
  const ts = nowIso();

  writeFileSync(join(ORCH_DIR, "MISSION.md"), renderMission(mission, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "MISSION.json"), JSON.stringify({ ts, ...mission }, null, 2) + "\n");

  if (JSON_OUT) { console.log(JSON.stringify({ ts, ...mission })); return; }
  console.log(`🧭 mission · ${mission.steps.length} sıralı adım · ≤2/model ${mission.maxTwoOk ? "✅" : "⚠️"} → MISSION.md`);
  for (const s of mission.steps) console.log(`  T${s.order} ${s.stream} [${s.tier}] ← ${s.dependsOn.join(",") || "start"} · ${s.models.join(", ") || "—"}`);
}

main();
