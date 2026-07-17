/**
 * orchestration/bin/lib/org-io.ts — thin IO shell for the pure organization engine.
 *
 * Loads the org chart (+ merges council roster seats), normalizes EVERY error-knowledge source into
 * PreventionRules (orchestration/contract/tunnel errors_registry.json + PROBLEM_REGISTRY.json), appends
 * ledger lines atomically, and writes error-registry additions as PROPOSAL files (PROPOSE-not-mutate —
 * the registry itself is only ever appended through a gated apply). All reads are tolerant: a malformed
 * source degrades to empty, never a crash (the conductor loop must survive anything).
 */
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  parseOrgChart, mergeRosterSeats, type OrgChart, type PreventionRule, type RosterSeat,
  type ErrorEntryProposal,
} from "./organization";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..", "..");
const REPO = join(ORCH_DIR, "..");
const STATE_DIR = process.env.ORG_STATE_DIR || join(homedir(), ".ollamas");

function readJson(p: string): unknown {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/** Load ORG_CHART.json and merge the council roster seats. THROWS on a malformed chart (degenerate data must not route). */
export function loadOrgChart(orchDir = ORCH_DIR): OrgChart {
  const chart = parseOrgChart(readJson(join(orchDir, "ORG_CHART.json")));
  const roster = readJson(join(orchDir, "COUNCIL_ROSTER.json")) as { seats?: RosterSeat[] } | null;
  return Array.isArray(roster?.seats) ? mergeRosterSeats(chart, roster.seats) : chart;
}

/** Normalize one errors_registry.json shape ({errors:[{id,root_cause,prevention_rule,…}], known_risks_preloaded:[{id,note}]}). */
function normalizeErrorsRegistry(json: unknown, source: string): PreventionRule[] {
  if (json === null || typeof json !== "object") return [];
  const r = json as Record<string, unknown>;
  const out: PreventionRule[] = [];
  for (const e of Array.isArray(r.errors) ? (r.errors as Record<string, unknown>[]) : []) {
    const rule = e.prevention_rule ?? e.prevention;
    if (typeof e.id === "string" && typeof rule === "string") {
      out.push({
        id: e.id, source,
        text: [e.file, e.category, e.root_cause].filter((v) => typeof v === "string").join(" "),
        rule,
      });
    }
  }
  for (const k of Array.isArray(r.known_risks_preloaded) ? (r.known_risks_preloaded as Record<string, unknown>[]) : []) {
    if (typeof k.id === "string" && typeof k.note === "string") {
      out.push({ id: k.id, source, text: `${k.category ?? ""} ${k.note}`, rule: k.note });
    }
  }
  return out;
}

/** Normalize PROBLEM_REGISTRY.json ({entries:[{category,pattern,provenSolution,…}]}). */
function normalizeProblemRegistry(json: unknown, source: string): PreventionRule[] {
  if (json === null || typeof json !== "object") return [];
  const r = json as Record<string, unknown>;
  const entries = Array.isArray(r.entries) ? (r.entries as Record<string, unknown>[]) : [];
  return entries.flatMap((e, i) =>
    typeof e.provenSolution === "string"
      ? [{
          id: `PROB-${typeof e.category === "string" ? e.category : i}`,
          source,
          text: `${e.category ?? ""} ${e.pattern ?? ""}`,
          rule: e.provenSolution,
        }]
      : [],
  );
}

/** Load + normalize ALL error-knowledge sources. Missing/malformed files degrade to empty. */
export function loadPreventionRules(repo = REPO): PreventionRule[] {
  return [
    ...normalizeErrorsRegistry(readJson(join(repo, "orchestration", "errors_registry.json")), "orchestration/errors_registry.json"),
    ...normalizeErrorsRegistry(readJson(join(repo, "contract", "errors_registry.json")), "contract/errors_registry.json"),
    ...normalizeErrorsRegistry(readJson(join(repo, "tunnel", "errors_registry.json")), "tunnel/errors_registry.json"),
    ...normalizeProblemRegistry(readJson(join(repo, "orchestration", "PROBLEM_REGISTRY.json")), "orchestration/PROBLEM_REGISTRY.json"),
  ];
}

/** Next ERR-ORG sequence number = 1 + highest existing in the proposals dir + registry (collision-free). */
export function nextErrorSeq(orchDir = ORCH_DIR): number {
  let max = 0;
  const scan = (text: string) => {
    for (const m of text.matchAll(/ERR-ORG-(\d{3})/g)) max = Math.max(max, Number(m[1]));
  };
  const reg = join(orchDir, "errors_registry.json");
  if (existsSync(reg)) { try { scan(readFileSync(reg, "utf8")); } catch { /* tolerant */ } }
  const prop = join(orchDir, "ERRORS_PROPOSED.json");
  if (existsSync(prop)) { try { scan(readFileSync(prop, "utf8")); } catch { /* tolerant */ } }
  return max + 1;
}

/**
 * PROPOSE-mode registry append: the proposal lands in orchestration/ERRORS_PROPOSED.json (append-only
 * array). Folding it into errors_registry.json is a gated, reviewed step — never automatic.
 */
export function proposeErrorEntry(entry: ErrorEntryProposal, orchDir = ORCH_DIR): string {
  const path = join(orchDir, "ERRORS_PROPOSED.json");
  const cur = readJson(path);
  const arr = Array.isArray(cur) ? (cur as unknown[]) : [];
  arr.push(entry);
  writeFileSync(path, JSON.stringify(arr, null, 2) + "\n");
  return path;
}

/** Atomic-enough append (single write syscall per line) of a JSON object to a JSONL file under ~/.ollamas. */
export function appendJsonl(file: string, obj: unknown, stateDir = STATE_DIR): string {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, file);
  appendFileSync(path, JSON.stringify(obj) + "\n");
  return path;
}
