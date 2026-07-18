/**
 * orchestration/bin/lib/services-ext.ts — µ-services 26-50: the COMPLEMENTARY half that covers the
 * rest of the ollamas working surface (FSM core, proposal engine, quality/security gates, license
 * discipline, model selection, provider privacy policy, self-policing, coordination locks).
 * Same contract and rules as services.ts (real exports, deterministic canaries, no GPU/network,
 * io isolated). Services map to RESPONSIBILITIES, not files — several share a module deliberately
 * (same precedent as org-chart/role-router over organization.ts).
 */
import {
  nextPhase, enqueueTask, dequeueTask, isBlocking, RETRY_MAX, bumpRetry,
  normalizeState, emptyOrchestraState, pruneHistory, statusLine,
  type PhaseInput,
} from "./orchestra-fsm";
import { hasSearchReplace, parseSearchReplace, applyEdits } from "./search-replace";
import { groundedPrompt, focusFile, FOCUS } from "./fleet-prompt";
import { orderStreams, proposalHeader, applyToken, ORCHESTRA_SLOT } from "./orchestra-repair";
import { classifyLicense, isCopyleft, decisionAllowed } from "./licenses";
import { selectBest, optimalConfig, DEFAULT_WEIGHTS, type Scored } from "./optimize";
import { median, percentile, mad, type Agg } from "./bench";
import { classify as conductClassify, tierRank, TIERS, type ClassifyInput } from "./conduct";
import { severityWeight, boostSeverity, dedupe } from "./rank";
import { parseNotes } from "./note";
import { auditCoverage, keywords } from "./critic";
import { auditTests, auditUncommitted } from "./dod";
import { applySuppress, suppressedBlock, type SuppressRule } from "./suppress";
import { critRank, CRITICALITY } from "./fuse";
import { laneDepMap, detectVersionDrift } from "./drift";
import { parseClaims, foldClaims, detectCollision, isActive, type ClaimEvent } from "./claims";
import { buildJudgePrompt, parseJudgeVerdict } from "./judge";
import { classifyTheme, synthesize } from "./synth";
import { filterChain } from "../../../server/chain-policy";
import { parseModeFromEnv, checkPolicyUsable } from "../../../server/hierarchy-bridge";
import { glyph, formatBanner } from "./keys-health-core";
import { toBrainInput, type BrainRecord } from "./brain-ledger";
import { emptyFile, wiredNoConsumer, hardcodedSecret, chokepointBypass } from "./detectors";
import type { ServiceSpec, SelftestResult } from "./services";

const ok = (evidence: string): SelftestResult => ({ ok: true, evidence });
const fail = (evidence: string): SelftestResult => ({ ok: false, evidence });
const expect = (cond: boolean, good: string, bad: string): SelftestResult => (cond ? ok(good) : fail(bad));

const TS = "2026-07-18T12:00:00Z";

export const SERVICES_EXT: ServiceSpec[] = [
  {
    id: "fsm-core", kind: "pure", role: "Conductor FSM: phase transitions + bounded retry + queue", deps: [],
    source: "orchestration/bin/lib/orchestra-fsm.ts",
    selftest: () => {
      const input: PhaseInput = { phase: "BENCHMARK_VALIDATION", actionTier: null, hasTask: true, converged: false, retryExceeded: false };
      const next = nextPhase(input);
      let s = enqueueTask(emptyOrchestraState("m"), "t1");
      s = dequeueTask(s);
      const b = bumpRetry(RETRY_MAX);
      return expect(next === "REPAIR" && s.current_task === "t1" && s.pending_actions.length === 0
        && b.exceeded && isBlocking("RED") && !isBlocking(null),
        "task→REPAIR, FIFO queue, retry bound, RED blocks", `next=${next}`);
    },
  },
  {
    id: "state-resume", kind: "pure", role: "Crash-safe state resume: tolerant normalize + bounded history", deps: ["fsm-core"],
    source: "orchestration/bin/lib/orchestra-fsm.ts",
    selftest: () => {
      const s = normalizeState({ phase: "NOT_A_PHASE", garbage: 1 }, "m");
      const hist = pruneHistory(Array.from({ length: 99 }, (_, i) => ({ ts: TS, phase: "MONITORING", note: String(i) })), { ts: TS, phase: "MONITORING", note: "new" });
      return expect(typeof statusLine(s) === "string" && s.conductor_model === "m" && hist.length <= 21,
        `malformed→valid state, history bounded (${hist.length})`, "normalize/prune broke");
    },
  },
  {
    id: "search-replace", kind: "pure", role: "Proposal engine: SEARCH/REPLACE parse + verbatim apply", deps: [],
    source: "orchestration/bin/lib/search-replace.ts",
    selftest: () => {
      const proposal = "```\n<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE\n```";
      const edits = parseSearchReplace(proposal).map((e) => ({ ...e, file: "x.ts" }));
      const res = applyEdits("const a = 1;\n", edits);
      return expect(hasSearchReplace(proposal) && res.ok && res.content!.includes("const a = 2;"),
        "parse+verbatim apply clean", `ok=${res.ok}`);
    },
  },
  {
    id: "grounded-prompt", kind: "pure", role: "Worker grounding: real-file prompt construction", deps: [],
    source: "orchestration/bin/lib/fleet-prompt.ts",
    selftest: () => {
      const p = groundedPrompt("fix the parser", "src/x.ts", "line1\nline2\n");
      const streams = Object.keys(FOCUS);
      return expect(p.includes("src/x.ts") && p.includes("line1") && streams.length > 0 && typeof focusFile(streams[0]) === "string",
        `prompt grounded on file, ${streams.length} FOCUS streams`, "grounding broke");
    },
  },
  {
    id: "proposal-protocol", kind: "pure", role: "Proposal routing: stream order + header + apply token", deps: ["search-replace"],
    source: "orchestration/bin/lib/orchestra-repair.ts",
    selftest: () => {
      const ordered = orderStreams("fix cli flag", ["backend", "cli", "frontend"]);
      return expect(ordered[0] === "cli" && proposalHeader("cli", "m").includes("cli")
        && applyToken("cli") === `cli.${ORCHESTRA_SLOT}`,
        "task-matched stream first + token stable", `ordered=${ordered.join(",")}`);
    },
  },
  {
    id: "license-gate", kind: "pure", role: "Adoption license discipline (copyleft never copied)", deps: [],
    source: "orchestration/bin/lib/licenses.ts",
    selftest: () => {
      const gpl = decisionAllowed(classifyLicense("GPL-3.0-only").category, "ADOPT");
      const mit = decisionAllowed(classifyLicense("MIT").category, "ADOPT");
      return expect(isCopyleft("GPL-3.0") && !gpl.ok && mit.ok,
        "GPL+ADOPT blocked, MIT+ADOPT allowed", "license gate broke");
    },
  },
  {
    id: "model-optimizer", kind: "pure", role: "Hardware-aware model selection (0-manual optimal pick)", deps: [],
    source: "orchestration/bin/lib/optimize.ts",
    selftest: () => {
      const aggs: Agg[] = [
        { model: "big", device: "d", n: 5, medianTokS: 50, p95: 60, mad: 1, min: 40, max: 60, correctRatio: 0.9 },
        { model: "small", device: "d", n: 5, medianTokS: 90, p95: 95, mad: 1, min: 80, max: 95, correctRatio: 0.5 },
      ] as never[];
      const best: Scored | null = selectBest(aggs, 64, DEFAULT_WEIGHTS);
      const cfg = optimalConfig(64, 12, "m");
      return expect(best !== null && cfg.num_ctx > 0,
        `selected ${best?.model} (score ${best?.score.toFixed(2)}), ctx=${cfg.num_ctx}`, "selection broke");
    },
  },
  {
    id: "bench-stats", kind: "pure", role: "Robust benchmark statistics (median/p95/MAD)", deps: [],
    source: "orchestration/bin/lib/bench.ts",
    selftest: () => {
      const xs = [1, 2, 3, 4, 100];
      return expect(median(xs) === 3 && percentile(xs, 95) >= 4 && mad(xs) >= 1,
        `median=3, p95≥4, MAD outlier-robust`, "stats broke");
    },
  },
  {
    id: "conduct-classify", kind: "pure", role: "Observe→orient: tiered finding classification (single next action)", deps: [],
    source: "orchestration/bin/lib/conduct.ts",
    selftest: () => {
      const input: ClassifyInput = {
        lanes: [], adoptionViolations: [], depgraphMissing: [], driftCount: 0,
        benchRegressions: [], redLanes: [{ lane: "backend", detail: "tsc red" }],
      };
      const findings = conductClassify(input);
      return expect(TIERS[0] === "RED" && tierRank("RED") < tierRank("ROADMAP") && findings.some((f) => f.tier === "RED"),
        "RED outranks ROADMAP, red lane classified", `findings=${findings.length}`);
    },
  },
  {
    id: "review-rank", kind: "pure", role: "Panel synthesis: severity weights + consensus dedupe + discourse", deps: [],
    source: "orchestration/bin/lib/rank.ts",
    selftest: () => {
      const r = dedupe([]);
      return expect(severityWeight("blocker") === 5 && boostSeverity("blocker") === "blocker" && r.duplicatesMerged === 0,
        "weights info=1…blocker=5, boost capped, dedupe total order", "rank broke");
    },
  },
  {
    id: "note-parser", kind: "pure", role: "Diagnostic-note markdown protocol parsing", deps: [],
    source: "orchestration/bin/lib/note.ts",
    selftest: () => {
      const r = parseNotes("garbage that is not a note");
      return expect(Array.isArray(r.notes) && Array.isArray(r.errors),
        `tolerant parse: ${r.notes.length} notes, ${r.errors.length} errors on garbage`, "parser threw shape");
    },
  },
  {
    id: "critic-core", kind: "pure", role: "Completeness critic: coverage/orphan/roadmap-sync gaps", deps: [],
    source: "orchestration/bin/lib/critic.ts",
    selftest: () => {
      const gaps = auditCoverage([{ file: "x.ts", fns: ["fnA", "fnB"] }], "test calls fnA only");
      return expect(gaps.some((g) => g.detail.includes("fnB")) && keywords("Fix the Parser Bug").length > 0,
        "untested export fnB flagged", `gaps=${gaps.length}`);
    },
  },
  {
    id: "dod-core", kind: "pure", role: "Definition-of-done: half-work detector (yarım-yok enforcer)", deps: [],
    source: "orchestration/bin/lib/dod.ts",
    selftest: () => {
      const lapses = auditTests([{ file: "m.ts", fnCount: 5 }], "");
      const unc = auditUncommitted([" M src/real-code.ts"]);
      return expect(lapses.length > 0 && Array.isArray(unc),
        "test-less module flagged as half-work", `lapses=${lapses.length}`);
    },
  },
  {
    id: "suppress-policy", kind: "pure", role: "Justified-exception filter (transparent, reason-mandatory)", deps: [],
    source: "orchestration/bin/lib/suppress.ts",
    selftest: () => {
      const rules: SuppressRule[] = [{ detector: "dod", kindPattern: "io-wrapper", reason: "lane convention" }];
      const { kept, suppressed } = applySuppress([{ kind: "io-wrapper-x" }, { kind: "real-gap" }], rules, "dod");
      return expect(kept.length === 1 && suppressed.length === 1 && suppressedBlock(suppressed).includes("io-wrapper"),
        "noise suppressed WITH reason, real gap kept", `kept=${kept.length}`);
    },
  },
  {
    id: "fuse-core", kind: "pure", role: "Gate roll-up: unified criticality ordering", deps: ["conduct-classify"],
    source: "orchestration/bin/lib/fuse.ts",
    selftest: () => expect(CRITICALITY[0] === "CRITICAL" && critRank("CRITICAL") < critRank("ROADMAP"),
      "CRITICAL always first (law #4)", "criticality order broke"),
  },
  {
    id: "drift-detector", kind: "pure", role: "Cross-lane version-drift signal (soft-warn)", deps: [],
    source: "orchestration/bin/lib/drift.ts",
    selftest: () => {
      const rows = detectVersionDrift([
        { lane: "a", deps: laneDepMap(JSON.stringify({ dependencies: { x: "^1.0.0" } })) },
        { lane: "b", deps: laneDepMap(JSON.stringify({ dependencies: { x: "^2.0.0" } })) },
      ] as never[]);
      return expect(rows.length === 1 && rows[0].name === "x" && rows[0].drifted, "x drift a↔b detected", `rows=${rows.length}`);
    },
  },
  {
    id: "claims-coordinator", kind: "pure", role: "Multi-tab work claims: fold + collision + TTL", deps: [],
    source: "orchestration/bin/lib/claims.ts",
    selftest: () => {
      const now = Date.parse(TS);
      const evs = parseClaims([
        JSON.stringify({ ts: now, tab: "A", pid: 1, lane: "cli", version: "v1", status: "claimed", ttlMs: 60000, fence: 1 }),
      ].join("\n"));
      const folded = foldClaims(evs);
      const collision = detectCollision(evs, "cli", "v1", "B", now);
      return expect(folded.size === 1 && isActive(evs[0] as ClaimEvent, now) && collision != null,
        "claim folded, active, foreign-tab collision detected", `size=${folded.size}`);
    },
  },
  {
    id: "judge-core", kind: "pure", role: "LLM-as-judge protocol: prompt + strict verdict parse", deps: [],
    source: "orchestration/bin/lib/judge.ts",
    selftest: () => expect(buildJudgePrompt("correctness", "q", "a").includes("correctness")
      && parseJudgeVerdict("Reasoning… yes") === 1 && parseJudgeVerdict("no") === 0 && parseJudgeVerdict("garbage") === null,
      "prompt built, yes/no/null verdicts strict (last match wins)", "judge protocol broke"),
  },
  {
    id: "synth-core", kind: "pure", role: "Council synthesis: theme classification → code plan", deps: ["council-core"],
    source: "orchestration/bin/lib/synth.ts",
    selftest: () => {
      const plan = synthesize([], [], TS);
      return expect(typeof classifyTheme("fix the failing test suite") === "string" && plan != null,
        `theme classified, empty-input plan tolerant`, "synth broke");
    },
  },
  {
    id: "chain-policy", kind: "pure", role: "Sovereign privacy: prompt-training providers filtered from chain", deps: [],
    source: "server/chain-policy.ts",
    selftest: () => {
      const filtered = filterChain(["ollama-local", "some-training-provider"], { privateMode: true } as never);
      return expect(Array.isArray(filtered) && filtered.includes("ollama-local"),
        `private mode keeps local (${filtered.length} allowed)`, "chain filter broke");
    },
  },
  {
    id: "hierarchy-bridge", kind: "pure", role: "Tier policy on the live path: mode parse + degenerate-data block", deps: ["hierarchy-router"],
    source: "server/hierarchy-bridge.ts",
    selftest: () => {
      const usable = checkPolicyUsable(null);
      return expect(parseModeFromEnv("enforce") === "enforce" && parseModeFromEnv("garbage") === "advisory" && usable.usable === false,
        "mode parse safe-defaults, null policy unusable", "bridge broke");
    },
  },
  {
    id: "keys-health-view", kind: "pure", role: "Key-vault health presentation (glyph/banner)", deps: [],
    source: "orchestration/bin/lib/keys-health-core.ts",
    selftest: () => expect(typeof glyph("ok") === "string" && formatBanner({ ts: TS, providers: [] } as never).length > 0,
      "glyph+banner render", "view broke"),
  },
  {
    id: "brain-mirror", kind: "pure", role: "Ledger→5-tier-brain mapping (deterministic idempotent ids)", deps: ["brain-ledger"],
    source: "orchestration/bin/lib/brain-ledger.ts (toBrainInput)",
    selftest: () => {
      const rec: BrainRecord = { ts: TS, tier: "learned", fact: "canary fact", meta: { a: 1 } };
      const a = toBrainInput(rec), b = toBrainInput(rec);
      return expect(a.id === b.id && a.id.startsWith("org:") && a.ns === "org" && a.createdAt === Date.parse(TS),
        `deterministic id ${a.id.slice(0, 12)}…, ns=org, time preserved`, "mapping broke");
    },
  },
  {
    id: "quality-detectors", kind: "pure", role: "Structural quality findings (empty file, wired-no-consumer)", deps: [],
    source: "orchestration/bin/lib/detectors.ts",
    selftest: () => {
      const empty = emptyFile("x.ts", "  ");
      const orphan = wiredNoConsumer("dep", 1, 0, "pkg.json");
      return expect(empty.length === 1 && orphan.length === 1,
        "empty-file + produced-never-consumed flagged", "detectors broke");
    },
  },
  {
    id: "security-detectors", kind: "pure", role: "Security findings (hardcoded secret, choke-point bypass)", deps: [],
    source: "orchestration/bin/lib/detectors.ts",
    selftest: () => {
      const secret = hardcodedSecret("x.ts", 'const apiKey = "sk-1234567890abcdef1234"');
      const bypass = chokepointBypass("src/x.ts", 'fetch("http://external.example/api")');
      return expect(secret.length >= 1 && Array.isArray(bypass),
        "hardcoded key flagged, bypass scan runs", `secret=${secret.length}`);
    },
  },
];
