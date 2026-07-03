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
import { readyApiProviders } from "./lib/ready-api";
import { buildMission, renderMission, DEFAULT_DEPS, type AssignmentLike } from "./lib/mission";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const JSON_OUT = process.argv.includes("--json");

// The canonical CODE_PLAN dependency DAG now lives in lib/mission.ts (DEFAULT_DEPS) so the fleet
// sequenced-launch order reuses the exact same ethical sequence — single source of truth.
const DEPS = DEFAULT_DEPS;

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

const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";

function nowIso(): string { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }

async function main(): Promise<void> {
  // Same key-live API-worker resolution as fleet-launch (server down/no keys -> legacy plan).
  const plan = buildFleetPlan(availableModels(), await readyApiProviders(OLLAMAS_URL));
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

main().catch((e) => { console.error(`[mission] ${e?.message ?? e}`); process.exit(1); });
