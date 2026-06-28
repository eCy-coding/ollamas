#!/usr/bin/env tsx
/**
 * orchestration/bin/conduct.ts — Zero-touch autonomous conductor (vO8).
 *
 * READ-ONLY, 0 manuel seçim/işlem: tek komut → tüm read-only sinyalleri topla (collect snapshot +
 * BENCH/OPTIMAL/depgraph/adopt JSON) → classify → DETERMİNİSTİK öncelik motoru tek-eylem seç →
 * reconcile delta → CONDUCTOR.md (birleşik durum + 🎯 tek-eylem + optimal-prompt). Lane'i act ETMEZ (§3).
 *
 * Çalıştır: tsx orchestration/bin/conduct.ts [--json] [--gate]
 * Exit: RED bulgu → 1 YALNIZ --gate ile (CI/pre-commit). Aksi 0 (RED, CONDUCTOR.md + JSON action.tier ile taşınır).
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collect, type CockpitSnapshot } from "./lib/collect";
import {
  classify, prioritize, reconcile, buildConductorReport, TIERS,
  type Finding, type ClassifyInput,
} from "./lib/conduct";
import {
  parseSysctl, selectBest, optimalConfig, buildWorkingPrompt, type Selection,
} from "./lib/optimize";
import { normalizeBenchmark, normalizeCliBench, aggregate } from "./lib/bench";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const MC = join(homedir(), ".llm-mission-control");
const STATE = join(ORCH_DIR, "conduct-state.jsonl");
const JSON_OUT = process.argv.includes("--json");
// --gate: RED-tier action → exit 1 (CI/pre-commit hard gate). Default OFF: a RED finding is a
// SIGNAL (carried by CONDUCTOR.md + JSON action.tier), NOT a process failure — so the 0-manuel
// autopilot chain (calls without --gate) doesn't false-fail when a RED action is legitimately found.
const GATE = process.argv.includes("--gate");

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function readMcJson(name: string): any { const f = join(MC, name); return existsSync(f) ? readJson(f) : null; }
function sysctl(k: string): string { try { return execFileSync("sysctl", ["-n", k], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }

/** DEPGRAPH.md'den MISSING satırlarını parse (machine-output yoksa md). */
function depgraphMissing(): string[] {
  const f = join(ORCH_DIR, "DEPGRAPH.md");
  if (!existsSync(f)) return [];
  const out: string[] = [];
  let inMissing = false;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (/^## MISSING/i.test(line)) { inMissing = true; continue; }
    if (inMissing && /^## /.test(line)) break;
    const m = inMissing && line.match(/\|\s*`(\/api\/[^`]+)`/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** son conduct-state satırından önceki Finding kind'leri. */
function prevKinds(): string[] {
  if (!existsSync(STATE)) return [];
  const lines = readFileSync(STATE, "utf8").trim().split("\n").filter(Boolean);
  if (!lines.length) return [];
  try { return JSON.parse(lines[lines.length - 1]).kinds || []; } catch { return []; }
}

async function main(): Promise<void> {
  // 1) OBSERVE — tüm read-only sinyaller (tek-kaynak collect + JSON çıktılar).
  const snap: CockpitSnapshot = await collect({ tabMap: null });
  const optimal = readJson(join(ORCH_DIR, "MODEL_SELECTION.json")); // vO6 füzyon: optimize CLI→benchprompt CLI
  const bench = readJson(join(ORCH_DIR, "BENCH.json"));
  const quality = readJson(join(ORCH_DIR, "QUALITY.json")); // vO9 quality-gate roll-up (tsc/test RED-lane)

  // 2) CLASSIFY girdisi.
  const ci: ClassifyInput = {
    lanes: snap.lanes.map((l) => ({ lane: l.lane, idle: l.idle, ageHours: l.ageHours, dirtyFiles: l.dirtyFiles, roadmapNext: l.roadmap.next })),
    adoptionViolations: snap.adoptions?.violations ?? [],
    depgraphMissing: depgraphMissing(),
    driftCount: 0, // drift.ts DEPGRAPH'a yazıyor; MISSING-only şimdilik (drift soft-warn RISK-ORCH-011)
    benchRegressions: (bench?.regressions ?? []).map((r: any) => ({ model: r.model, dropPct: r.dropPct })),
    redLanes: Array.isArray(quality?.redLanes) ? quality.redLanes : [], // vO9: quality.ts roll-up (tsc-fail/test-failed) → RED-lane sinyali
  };
  const baseFindings: Finding[] = classify(ci);

  // vO10-12 ÖZ-DENETİM wiring: critic (completeness audit) + dod (yarım-iş gate) çıktılarını TÜKET.
  // CRITIC.json/DOD.json findings'i ZATEN Finding-şekilli (tier=COMPLETENESS) → doğrula+merge (orphan-değil).
  const critic = readJson(join(ORCH_DIR, "CRITIC.json"));
  const dod = readJson(join(ORCH_DIR, "DOD.json"));
  const selfPolice: Finding[] = [...(critic?.findings ?? []), ...(dod?.findings ?? [])]
    .filter((f: any) => f && typeof f.kind === "string" && typeof f.severity === "number" && (TIERS as readonly string[]).includes(f.tier));
  const findings: Finding[] = [...baseFindings, ...selfPolice];
  const action = prioritize(findings);

  // 3) RECONCILE delta (idempotent).
  const delta = reconcile(prevKinds(), findings);

  // 4) Optimal working-prompt (canlı selectBest; fallback MODEL_SELECTION.json — vO6 füzyon).
  let workingPrompt = "_(MODEL_SELECTION.json yok — `tsx orchestration/bin/benchprompt.ts` koş)_";
  const sys = parseSysctl(sysctl("hw.memsize"), sysctl("hw.physicalcpu"), sysctl("machdep.cpu.brand_string"));
  const records = [
    ...(readMcJson("benchmark.json") ? normalizeBenchmark(readMcJson("benchmark.json")) : []),
    ...(readMcJson("cli-bench.json") ? normalizeCliBench(readMcJson("cli-bench.json")) : []),
  ].filter((r) => r.device === "mac");
  const aggs = aggregate(records);
  const best = aggs.length ? selectBest(aggs, sys.ramGb) : null;
  if (best) {
    const sel: Selection = { sys, model: best.model, score: best.score, tokS: best.tokS, config: optimalConfig(sys.ramGb, sys.cores, best.model), reason: best.reason };
    const principles = "choke-point tek-dispatch, TDD, evidence-first, no-vibe-code, zero-dep, correctness>hız.";
    const base = buildWorkingPrompt(sel, principles);
    // Seçili eyleme bağla.
    workingPrompt = action ? `${base}\n\n<next-action>\n${action.action}\n</next-action>` : base;
  } else if (optimal?.selection?.model) {
    const s = optimal.selection; // MODEL_SELECTION.json: {selection:{model,tokS,config}}
    workingPrompt = `Model: ${s.model} (${s.tokS} tok/s) · config ${JSON.stringify(s.config)}`;
  }

  // 5) Birleşik durum özeti (quality-gate roll-up: lane + bench + config).
  const champ = bench?.best?.mac;
  const summary = [
    `| Lane | Şu an | → Sıradaki | dirty | idle |`,
    `|------|-------|-----------|-------|------|`,
    ...snap.lanes.map((l) => `| \`${l.lane}\` | ${l.roadmap.current || "—"} | ${l.roadmap.next || "—"} | ${l.dirtyFiles}△ | ${l.idle ? "💤" : "✓"} |`),
    ``,
    `**Bench:** ${champ ? `🏆 ${champ.model} ${champ.medianTokS} tok/s` : "veri yok"} · **Optimal:** ${optimal?.selection ? `${optimal.selection.model} num_ctx=${optimal.selection.config?.num_ctx ?? "?"}` : "—"} · **Lane:** ${snap.lanes.length} · **Toplam:** ${snap.totals.dirty}△ ${snap.totals.idle}💤 ${snap.totals.errors}✗`,
  ].join("\n");

  const report = buildConductorReport({ ts: snap.ts, summary, findings, action, delta, workingPrompt });

  // 6) EMIT.
  if (JSON_OUT) {
    console.log(JSON.stringify({ ts: snap.ts, action, findings, delta }, null, 2));
  } else {
    console.log(report);
  }
  writeFileSync(join(ORCH_DIR, "CONDUCTOR.md"), report + "\n");
  appendFileSync(STATE, JSON.stringify({ ts: snap.ts, kinds: findings.map((f) => f.kind), action: action?.kind ?? null }) + "\n");
  console.error(`[conduct] ${findings.length} bulgu, eylem=${action ? action.tier + ":" + action.lane : "yok"}, delta +${delta.added.length}/-${delta.resolved.length}.`);

  if (GATE && action?.tier === "RED") process.exit(1);
}

main();
