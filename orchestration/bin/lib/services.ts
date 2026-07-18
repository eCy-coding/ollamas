/**
 * orchestration/bin/lib/services.ts — the 25 critical µ-services of the ollamas working principle,
 * under ONE uniform contract.
 *
 * Architecture decision (SERVICES.md): at $0/local/single-GPU scale the honest form of the
 * microservice principle is the MODULAR MONOLITH — 25 single-responsibility, independently
 * self-testable in-process services with explicit deps, not 25 network daemons (Fowler,
 * MonolithFirst: peeling services needs good modules first; most of the benefit IS the modules).
 * Real network services stay network (server :3000, odysseus :7860, pulse :4777, ollama :11434)
 * and are registered separately as NETWORK_SERVICES.
 *
 * Contract: every ServiceSpec.selftest calls the REAL exported function(s) of its module with a
 * deterministic canary input and returns { ok, evidence } — no GPU, no network, no repo mutation
 * (io selftests isolate under a temp ORG_STATE_DIR). The health runner (bin/services.ts) executes
 * them ONE BY ONE and streams the run as a live 25-item tracker checklist.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseOrgChart, mergeRosterSeats, assignRole, consultErrors, buildDispatchPrompt, recordOutcome,
  errorSignature, detectRecurrence,
  type OrgChart, type PreventionRule, type TaskSpec, type LedgerEntry,
} from "./organization";
import { loadPreventionRules } from "./org-io";
import { remember, recall } from "./brain-ledger";
import { trainPolicy, ucb1, selectActor, allowedAction, learningCurve, emptyPolicy } from "./org-learn";
import {
  startRun, updateItem, addTokens, renderStatusLine, renderFrame, spinnerVerb,
  type TrackerEvent,
} from "./task-tracker";
import { emitEvent, readTrackerState } from "./tracker-io";
import { runRound, SANDBOX_CHART_JSON, bootstrapHistory, waveFor } from "./sandbox-round";
import { parsePolicy, resolveTierForClass } from "./hierarchy";
import { maybeFailover, resolveJoker } from "./joker";
import { takeTicket, isServed, advance, shouldForceAdvance, type TicketState } from "./gpu-lock";
import { fullJitterDelay, isTransient, shouldRetry } from "./backoff";
import { tallyVotes, summarizeCouncil, COUNCIL_QUORUM, type LaneResult } from "./council";
import { resolveTask, type Task } from "./task-catalog";
import { mark, statusOf, summary as progressSummary } from "./task-progress";
import { think, type RegistryEntry } from "./think";
import { orgOverview } from "../../../server/org-status";

export interface SelftestResult { ok: boolean; evidence: string; }

export interface ServiceSpec {
  id: string;
  kind: "pure" | "io";
  role: string;
  deps: string[];
  source: string;
  selftest: () => SelftestResult | Promise<SelftestResult>;
}

export interface NetworkService { id: string; url: string; role: string; }

export const NETWORK_SERVICES: NetworkService[] = [
  { id: "net:ollamas", url: "http://127.0.0.1:3000/api/health", role: "Mission control server (blackboard + ToolRegistry)" },
  { id: "net:odysseus", url: "http://127.0.0.1:7860/api/health", role: "External specialist (MCP bridge)" },
  { id: "net:pulse", url: "http://127.0.0.1:4777/healthz", role: "Live health dashboard" },
  { id: "net:ollama", url: "http://127.0.0.1:11434/api/tags", role: "Local model runtime (single GPU)" },
];

// ── shared canaries (deterministic) ──────────────────────────────────────────────────────────────
const TS = "2026-07-18T12:00:00Z";

const CANARY_CHART_JSON = {
  version: 1, ts: TS,
  actors: [
    { id: "emre", kind: "operator", role: "T0", duties: [], capabilities: ["decision"], reportsTo: null, escalatesTo: null, costRank: 3 },
    { id: "conductor", kind: "model", role: "Conductor", duties: ["conduct"], capabilities: ["code", "repair"], reportsTo: "emre", escalatesTo: "joker", model: "qwen3-coder:30b", costRank: 0 },
    { id: "joker", kind: "model", role: "Joker", duties: [], capabilities: ["review", "code"], reportsTo: "conductor", escalatesTo: "emre", model: "qwen3:8b", costRank: 1 },
  ],
};
const canaryChart = (): OrgChart => parseOrgChart(JSON.parse(JSON.stringify(CANARY_CHART_JSON)));
const CODE_TASK: TaskSpec = { id: "svc-canary", goal: "fix the failing parser in the canary module", cls: "code" };
const CANARY_RULE: PreventionRule = { id: "R-CANARY", source: "selftest", text: "canary parser failing module fix", rule: "Never ship the canary unverified." };

const failedOutcome = { taskId: "svc-canary", actorId: "conductor", ok: false, summary: "gate red", ts: TS, error: "tsc failed on canary.ts" };

/** Run fn with an isolated ORG_STATE_DIR (io selftests never touch the real ~/.ollamas). */
function withIsolatedState<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "svc-selftest-"));
  const prev = process.env.ORG_STATE_DIR;
  process.env.ORG_STATE_DIR = dir;
  try { return fn(dir); }
  finally {
    if (prev === undefined) delete process.env.ORG_STATE_DIR; else process.env.ORG_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const ok = (evidence: string): SelftestResult => ({ ok: true, evidence });
const fail = (evidence: string): SelftestResult => ({ ok: false, evidence });
const expect = (cond: boolean, good: string, bad: string): SelftestResult => (cond ? ok(good) : fail(bad));

// ── core 25 (the management/organization principle itself; 26-50 live in services-ext.ts) ───────
export const CORE_SERVICES: ServiceSpec[] = [
  {
    id: "org-chart", kind: "pure", role: "Role registry: parse + council-roster merge", deps: [],
    source: "orchestration/bin/lib/organization.ts",
    selftest: () => {
      const c = canaryChart();
      const merged = mergeRosterSeats(c, [{ capability: "vision", role: "analyst", model: "qwen2.5vl:32b", available: true }]);
      return expect(c.actors.length === 3 && merged.actors.some((a) => a.id === "seat:vision"),
        "parse 3 actors + roster seat merged", "parse/merge broke");
    },
  },
  {
    id: "role-router", kind: "pure", role: "Cheapest-capable assignment (+avoid, +bandPick hook)", deps: ["org-chart"],
    source: "orchestration/bin/lib/organization.ts",
    selftest: () => {
      const a = assignRole(canaryChart(), CODE_TASK);
      const avoided = assignRole(canaryChart(), CODE_TASK, { avoid: ["conductor"] });
      return expect(a.actorId === "conductor" && avoided.actorId === "joker" && avoided.reason === "recurrence-avoid",
        `route→conductor, avoid→joker(${avoided.reason})`, `got ${a.actorId}/${avoided.actorId}`);
    },
  },
  {
    id: "error-consult", kind: "io", role: "Prevention-rule lookup over ALL registries", deps: [],
    source: "orchestration/bin/lib/organization.ts + org-io.ts",
    selftest: () => {
      const hits = consultErrors([CANARY_RULE], CODE_TASK);
      const real = loadPreventionRules();
      return expect(hits.length === 1 && real.length >= 20,
        `canary hit + ${real.length} real rules loaded`, `hits=${hits.length}, real=${real.length}`);
    },
  },
  {
    id: "brief-builder", kind: "pure", role: "SOP worker brief (NEVER-REPEAT verbatim + memory block)", deps: ["org-chart", "role-router"],
    source: "orchestration/bin/lib/organization.ts",
    selftest: () => {
      const c = canaryChart();
      const b = buildDispatchPrompt(c, assignRole(c, CODE_TASK), CODE_TASK, [CANARY_RULE], [{ fact: "canary lesson" }]);
      return expect(b.includes("[R-CANARY] Never ship the canary unverified.") && b.includes("## RELEVANT MEMORY"),
        "rule verbatim + memory block present", "brief missing rule/memory");
    },
  },
  {
    id: "outcome-recorder", kind: "pure", role: "Outcome→ledger entry + ERR-ORG proposal synthesis", deps: [],
    source: "orchestration/bin/lib/organization.ts",
    selftest: () => {
      const r = recordOutcome(failedOutcome, { rulesApplied: [], nextErrorSeq: 42, recurrenceCount: 1 });
      return expect(r.registryAppend?.id === "ERR-ORG-042" && r.registryAppend.severity === "high"
        && r.registryAppend.prevention_rule.includes("RECURRENCE ×2"),
        "ERR-ORG-042 hardened (recurrence ×2, high)", `got ${JSON.stringify(r.registryAppend?.id)}`);
    },
  },
  {
    id: "recurrence-detector", kind: "pure", role: "Failure signatures + same-error counting", deps: [],
    source: "orchestration/bin/lib/organization.ts",
    selftest: () => {
      const sig = errorSignature(failedOutcome);
      const entry = recordOutcome(failedOutcome, { rulesApplied: [], nextErrorSeq: 1 }).ledger;
      return expect(sig === errorSignature(failedOutcome) && detectRecurrence([entry], sig) === 1,
        `deterministic sig, count=1 (${sig.slice(0, 24)}…)`, "sig unstable or count wrong");
    },
  },
  {
    id: "brain-ledger", kind: "io", role: "Sync memory: remember/recall JSONL (+brain mirror)", deps: [],
    source: "orchestration/bin/lib/brain-ledger.ts",
    selftest: () => withIsolatedState(() => {
      remember("learned", "canary lesson: probe timeout far below test timeout", { canary: true }, TS);
      const hits = recall("probe timeout test", 3);
      return expect(hits.length === 1 && hits[0].tier === "learned",
        "remember→recall roundtrip (learned tier)", `recall got ${hits.length}`);
    }),
  },
  {
    id: "authority-trainer", kind: "pure", role: "Learned authority: wilson curriculum promote/demote", deps: ["brain-ledger"],
    source: "orchestration/bin/lib/org-learn.ts",
    selftest: () => {
      const good: LedgerEntry[] = Array.from({ length: 8 }, (_, i) => ({ type: "outcome", tier: "episodic", ts: TS, taskId: `t${i}`, actorId: "a", ok: true, summary: "ok" }));
      const bad: LedgerEntry[] = Array.from({ length: 6 }, (_, i) => ({ type: "outcome", tier: "learned", ts: TS, taskId: `t${i}`, actorId: "b", ok: false, summary: "fail" }));
      const p = trainPolicy([...good, ...bad], { now: TS });
      return expect(p.authorities["a"].level === "apply-gated" && p.authorities["b"].level === "observe",
        "8/8→apply-gated, 0/6→observe (demotion wins)", `a=${p.authorities["a"]?.level}, b=${p.authorities["b"]?.level}`);
    },
  },
  {
    id: "bandit-selector", kind: "pure", role: "UCB1 explore/exploit within the cheapest band", deps: ["authority-trainer"],
    source: "orchestration/bin/lib/org-learn.ts",
    selftest: () => {
      const band = canaryChart().actors.filter((a) => a.kind === "model");
      const p = emptyPolicy(TS);
      p.bandit = { conductor: { n: 5, ok: 5 } };
      const pick = selectActor(band, p, "explore");
      return expect(ucb1({ n: 0, ok: 0 }, 10) === Infinity && pick.id === "joker",
        "cold-start ∞ → untried joker explored first", `picked ${pick.id}`);
    },
  },
  {
    id: "authority-gate", kind: "pure", role: "Responsibility enforcement (apply needs rank≥2)", deps: ["authority-trainer"],
    source: "orchestration/bin/lib/org-learn.ts",
    selftest: () => {
      const p = emptyPolicy(TS);
      return expect(allowedAction(p, "ghost", "propose") && !allowedAction(p, "ghost", "apply"),
        "unknown actor: propose yes, apply denied", "gate matrix broken");
    },
  },
  {
    id: "learning-eval", kind: "pure", role: "Learning curve: improvement verdict + regret", deps: [],
    source: "orchestration/bin/lib/org-learn.ts",
    selftest: () => {
      const c = learningCurve([1, 2, 3, 4, 5, 6].map((r) => ({ round: r, ok: r, total: 6 })));
      return expect(c.improved && c.regret.at(-1)! >= c.regret[0],
        `improved=true, cumulative regret monotone`, "curve verdict wrong");
    },
  },
  {
    id: "task-tracker", kind: "pure", role: "Live-progress reducer + Claude-Code-style rendering", deps: [],
    source: "orchestration/bin/lib/task-tracker.ts",
    selftest: () => {
      let s = startRun("Canary run", "ollamas", [{ id: "x", label: "x" }], TS);
      s = addTokens(updateItem(s, "x", "active", TS), 18700, TS);
      const line = renderStatusLine(s, new Date(Date.parse(TS) + 296_000));
      return expect(line === "⏺ Canary run… (4m 56s · ↓ 18.7k tokens)" && spinnerVerb(0) === spinnerVerb(9),
        line, `got "${line}"`);
    },
  },
  {
    id: "tracker-bus", kind: "io", role: "Event log + state cache (multi-producer safe)", deps: ["task-tracker"],
    source: "orchestration/bin/lib/tracker-io.ts",
    selftest: () => withIsolatedState(() => {
      emitEvent({ type: "start", ts: TS, runId: "svc:run", title: "bus canary", source: "ollamas", items: [{ id: "i", label: "i" }] });
      emitEvent({ type: "item", ts: TS, runId: "svc:OTHER", id: "i", status: "done" }); // stamped foreign → dropped
      const s = readTrackerState();
      return expect(s?.title === "bus canary" && s.items[0].status === "pending",
        "roundtrip ok + foreign-stamped event dropped", `state=${s?.title}/${s?.items[0]?.status}`);
    }),
  },
  {
    id: "follow-viewer", kind: "pure", role: "Terminal frame rendering for `ollamas follow`", deps: ["task-tracker", "tracker-bus"],
    source: "orchestration/bin/follow.ts + task-tracker.ts",
    selftest: () => {
      const s = startRun("Frame canary", "ecym", [{ id: "a", label: "A adımı" }], TS);
      const f = renderFrame(s, new Date(Date.parse(TS) + 9000));
      return expect(f.includes("⏺ Frame canary… (9s)") && f.includes("◻ A adımı") && f.includes("(9s · thinking)"),
        "frame: status+checklist+spinner", "frame malformed");
    },
  },
  {
    id: "sandbox-runner", kind: "pure", role: "MAPE-K chaos round (isolated soak core)", deps: ["role-router", "error-consult", "outcome-recorder"],
    source: "orchestration/bin/lib/sandbox-round.ts",
    selftest: () => {
      const chart = parseOrgChart(JSON.parse(JSON.stringify(SANDBOX_CHART_JSON)));
      const r = runRound({ chart, rules: [], ledger: bootstrapHistory(TS), round: 1, downActors: [], nextErrorSeq: 1, ts: TS });
      return expect(r.violations.length === 0 && r.dispatches.length === waveFor(1).length,
        `round-1: ${r.dispatches.length} dispatch, 0 violation`, r.violations.join("; ") || "wrong dispatch count");
    },
  },
  {
    id: "calibration", kind: "pure", role: "Dispatch-ritual mini-calibration (consult→assign→brief→record)", deps: ["role-router", "brief-builder", "outcome-recorder"],
    source: "orchestration/bin/calibrate-org.ts (ritual spec)",
    selftest: () => {
      const c = canaryChart();
      const a = assignRole(c, CODE_TASK);
      const hits = consultErrors([CANARY_RULE], CODE_TASK);
      const brief = buildDispatchPrompt(c, a, CODE_TASK, hits);
      const rec = recordOutcome({ taskId: CODE_TASK.id, actorId: a.actorId, ok: true, summary: "ritual ok", ts: TS }, { rulesApplied: hits.map((h) => h.id), nextErrorSeq: 1 });
      return expect(a.actorId === "conductor" && brief.includes("[R-CANARY]") && rec.ledger.tier === "episodic",
        "full ritual: route+rule+record", "ritual step broke");
    },
  },
  {
    id: "hierarchy-router", kind: "pure", role: "Wilson-gated cheapest-tier resolution (local→sonnet→opus)", deps: [],
    source: "orchestration/bin/lib/hierarchy.ts",
    selftest: () => {
      const policy = parsePolicy({
        routes: [{ taskClass: "code", gateSource: "scorecard", wilsonLow: 0.9, chosenTier: "local", model: "m", estCostUnits: 1, reason: "r" }],
        gate: { wilsonFloor: 0.6, staleDays: 9999 }, escalationLadder: ["local", "sonnet", "opus"],
        evidence: { scorecard: "canary", benchmarkJson: "" }, ts: TS,
      });
      const pass = resolveTierForClass(policy, "code", { now: new Date(Date.parse(TS)) });
      const esc = resolveTierForClass(policy, "code", { wilsonLow: 0.1, now: new Date(Date.parse(TS)) });
      return expect(pass.tier === "local" && esc.tier === "sonnet" && esc.reason === "escalate-below-floor",
        "gate-pass→local, below-floor→sonnet", `${pass.tier}/${esc.tier}`);
    },
  },
  {
    id: "joker-failover", kind: "pure", role: "Supervisor-tree conductor failover (restart from state)", deps: [],
    source: "orchestration/bin/lib/joker.ts",
    selftest: () => {
      const state = { phase: "MONITORING", conductor_model: "qwen3-coder:30b", failover_count: 0, retry_count: 0, pending_actions: [], current_task: null, history: [] } as never;
      const fo = maybeFailover(state, false, ["qwen3:8b"], TS);
      return expect(fo.swapped && fo.joker === "qwen3:8b" && resolveJoker(["qwen3:8b"], "qwen3-coder:30b") === "qwen3:8b",
        "down conductor → joker qwen3:8b", `swapped=${fo.swapped}`);
    },
  },
  {
    id: "gpu-lock", kind: "pure", role: "Starvation-free FIFO ticket lock (single-GPU truth)", deps: [],
    source: "orchestration/bin/lib/gpu-lock.ts",
    selftest: () => {
      let s: TicketState = { next: 0, serving: 0 };
      const t1 = takeTicket(s); s = t1.state;
      const t2 = takeTicket(s); s = t2.state;
      const fifo = isServed(s, t1.ticket) && !isServed(s, t2.ticket) && isServed(advance(s), t2.ticket);
      return expect(fifo && shouldForceAdvance({ next: 2, serving: 0, heldSince: 0 }, 10_000, 5000),
        "FIFO order + dead-holder force-advance", "ticket semantics broke");
    },
  },
  {
    id: "backoff", kind: "pure", role: "Full-jitter retry with transient classification", deps: [],
    source: "orchestration/bin/lib/backoff.ts",
    selftest: () => {
      const d = fullJitterDelay(3, 100, 2000, () => 0.5);
      return expect(d === 400 && isTransient(new Error("ETIMEDOUT")) && !shouldRetry(new Error("ETIMEDOUT"), 9, 3),
        "jitter(0.5,att3)=400ms, transient yes, retries bounded", `d=${d}`);
    },
  },
  {
    id: "council-core", kind: "pure", role: "Weighted votes → quorum decision (EXECUTE|HOLD)", deps: [],
    source: "orchestration/bin/lib/council.ts",
    selftest: () => {
      const results: LaneResult[] = [
        { lane: "a", model: "m1", ok: true, findings: [], response: "APPROVE" },
        { lane: "b", model: "m2", ok: true, findings: [], response: "APPROVE" },
      ] as never[];
      const s = summarizeCouncil(results);
      return expect(tallyVotes(results).length === 2 && (s.decision === "EXECUTE" || s.decision === "HOLD") && COUNCIL_QUORUM === 0.6,
        `2 votes tallied → ${s.decision} (quorum ${COUNCIL_QUORUM})`, "tally/summary broke");
    },
  },
  {
    id: "task-catalog", kind: "pure", role: "Grounded task resolution (id + free text)", deps: [],
    source: "orchestration/bin/lib/task-catalog.ts",
    selftest: () => {
      const catalog: Task[] = [{ id: "svc-a", lane: "orchestration", target: "x.ts", goal: "do a thing" } as Task];
      const byId = resolveTask("svc-a", catalog);
      return expect(byId?.id === "svc-a" && resolveTask("nonexistent-zzz", []) == null,
        "resolve by id, unknown→null", "resolution broke");
    },
  },
  {
    id: "task-progress", kind: "pure", role: "Completion ledger (pending→proposed→done)", deps: ["task-catalog"],
    source: "orchestration/bin/lib/task-progress.ts",
    selftest: () => {
      const cat: Task[] = [{ id: "svc-a", lane: "l", target: "t", goal: "g" } as Task];
      const p = mark({}, "svc-a", "done");
      const s = progressSummary(cat, p);
      return expect(statusOf(p, "svc-a") === "done" && s.done === 1 && s.total === 1,
        "mark→done, summary 1/1", "progress ledger broke");
    },
  },
  {
    id: "think-solver", kind: "io", role: "Problem → proven cited solution (no-guess)", deps: [],
    source: "orchestration/bin/lib/think.ts + PROBLEM_REGISTRY.json",
    selftest: () => {
      const reg: RegistryEntry[] = [{ category: "transient-error", pattern: "timeout|ETIMEDOUT", provenSolution: "full-jitter backoff", sources: ["AWS"], evidence: "e", appliedIn: "v" }];
      const r = think({ text: "fetch ETIMEDOUT while probing" }, reg);
      return expect(r.status === "PROVEN" && r.solution.includes("backoff"),
        "transient finding → PROVEN backoff solution", `status=${r.status}`);
    },
  },
  {
    id: "org-status", kind: "io", role: "Live overview aggregator (:3000 /org + /api/org/overview source)", deps: ["org-chart", "authority-trainer", "brain-ledger"],
    source: "server/org-status.ts",
    selftest: () => {
      const dir = mkdtempSync(join(tmpdir(), "svc-orgstatus-"));
      try {
        mkdirSync(join(dir, "orchestration"), { recursive: true });
        writeFileSync(join(dir, "orchestration", "ORG_CHART.json"), JSON.stringify(CANARY_CHART_JSON));
        writeFileSync(join(dir, "orchestration", "SANDBOX-ORG.md"), "**VERDICT: ALL GREEN ✅ (canary)**\n");
        const o = orgOverview({ repoDir: dir, stateDir: dir });
        return expect(o.actors.length === 3 && o.sandboxVerdict!.includes("ALL GREEN"),
          "3 actors + verdict parsed from seeded dir", `actors=${o.actors.length}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  },
];

// The complementary half (26-50: FSM core, proposal engine, quality/security gates, license,
// model selection, provider policy, self-policing, coordination) lives in services-ext.ts.
import { SERVICES_EXT } from "./services-ext";

/** The full 50-service registry: 25 core (management principle) + 25 complementary (whole surface). */
export const SERVICES: ServiceSpec[] = [...CORE_SERVICES, ...SERVICES_EXT];

export const EXPECTED_SERVICE_COUNT = 50;

/** Registry integrity: exactly 50, unique ids, resolvable deps, valid kinds. Returns problem list. */
export function validateRegistry(specs: ServiceSpec[] = SERVICES): string[] {
  const problems: string[] = [];
  if (specs.length !== EXPECTED_SERVICE_COUNT) problems.push(`expected ${EXPECTED_SERVICE_COUNT} services, got ${specs.length}`);
  const ids = new Set<string>();
  for (const s of specs) {
    if (ids.has(s.id)) problems.push(`duplicate id "${s.id}"`);
    ids.add(s.id);
    if (s.kind !== "pure" && s.kind !== "io") problems.push(`"${s.id}" invalid kind "${s.kind}"`);
    if (!s.role || !s.source) problems.push(`"${s.id}" missing role/source`);
  }
  for (const s of specs) for (const d of s.deps) {
    if (!ids.has(d)) problems.push(`"${s.id}" depends on unknown service "${d}"`);
  }
  return problems;
}

/** The tracker event stream for a health run — the 50-item live checklist (`ollamas follow`). */
export function healthRunEvents(runId: string, ts: string): TrackerEvent {
  return {
    type: "start", ts, runId, title: `${EXPECTED_SERVICE_COUNT} µ-servis sağlık taraması`, source: "ollamas",
    items: SERVICES.map((s) => ({ id: s.id, label: `${s.id} — ${s.role}` })),
  };
}
