#!/usr/bin/env tsx
/**
 * orchestration/bin/converge.ts — lane-convergence ORCHESTRATION LOGIC (planner).
 *
 * Produces the deterministic plan for landing one lane into the trunk via the shared
 * `integration/all-lanes` staging branch:
 *
 *     merge trunk → lane      (bring the lane up to date)
 *   → gate lane               (tsc + vitest + security-gate)
 *   → merge --no-ff lane → integration
 *   → gate integration
 *   → [T0] fast-forward trunk → integration   (Emre-only ref advance)
 *   → re-merge the remaining lanes onto the advanced trunk
 *
 * SAFETY CONTRACT (v1.30.2): this tool NEVER writes a git ref. `--dry-run` (the DEFAULT)
 * only READS — `git merge-base --is-ancestor`, `git diff --name-only`, `git rev-list` — and
 * prints the plan + a conflict forecast. The real merge/commit/push/branch -f execution is
 * deferred to v1.30.3 and is [T0]-gated (Emre approves). `buildExecuteCommands()` renders the
 * git argv the executor *would* run, but converge.ts itself does not run them and `--execute`
 * only PREVIEWS them (labelled NOT-RUN). `git add -A` is never emitted.
 *
 * Conflict policy is encoded in `classifyConflict()`:
 *   - security workflow / .semgrep guards → the security lane wins (never hand-merged)
 *   - generated artifacts (orchestration/out, CRITIC/COUNCIL, DOD_LANES) → regenerate, don't merge
 *   - package.json / lockfile / .gitignore → union
 *   - everything else → hand-merge ([T0])
 *
 * Run:  tsx orchestration/bin/converge.ts --dry-run <lane> [--trunk=<b>] [--integration=<b>] [--json]
 */
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectLanes, detectTrunk } from "./lane-triage";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/** Default staging branch every lane funnels through before touching the trunk. */
export const DEFAULT_INTEGRATION = "integration/all-lanes";

/** How a conflicting path is resolved. Encoded policy — no free-hand merges of these zones. */
export type ConflictPolicy = "security-wins" | "regenerate" | "union" | "hand-merge";

export interface ConflictZone {
  path: string;
  policy: ConflictPolicy;
}

export interface ConvergeStep {
  n: number;
  kind: "merge" | "gate" | "t0";
  /** true iff this step would mutate a git ref (merge/commit/push/branch -f). */
  refWrite: boolean;
  detail: string;
}

export interface ConvergePlan {
  lane: string;
  trunk: string;
  integration: string;
  remaining: string[];
  steps: ConvergeStep[];
}

/**
 * Pure: classify a conflicted path into its resolution policy. Order matters — the most
 * specific / highest-authority zones are tested first (security beats generated beats union).
 */
export function classifyConflict(path: string): ConflictPolicy {
  const p = path.trim();
  // Security posture is authoritative: the security lane's version always wins.
  if (p === ".github/workflows/security.yml" || p.startsWith(".semgrep/") || p === "docs/audit/SEC-BASELINE.md") {
    return "security-wins";
  }
  // Generated artifacts are never hand-merged — regenerate from source after the merge.
  if (
    p.startsWith("orchestration/out/") ||
    /^orchestration\/(CRITIC|COUNCIL|DOD_LANES)(\.|$)/.test(p) ||
    /^orchestration\/(TASKS|BUILD_PLAN|ALIGN|AUTOMATOR_)/.test(p)
  ) {
    return "regenerate";
  }
  // Additive manifests: take the union of both sides.
  if (p === "package.json" || p === "package-lock.json" || p === ".gitignore") {
    return "union";
  }
  return "hand-merge";
}

/**
 * Pure: convergence lane ordering — security lanes FIRST, key-autonomy (trunk/final) LAST,
 * everything else alphabetically in the middle. Deterministic.
 */
export function laneRank(lane: string): number {
  if (/security/i.test(lane)) return 0;
  if (lane === "feat/key-autonomy") return 2;
  return 1;
}

export function mergeOrder(lanes: readonly string[]): string[] {
  return [...lanes].sort((a, b) => laneRank(a) - laneRank(b) || a.localeCompare(b));
}

/**
 * Pure: forecast conflict zones as the intersection of files changed on the trunk and on the
 * lane since their merge-base. Each touched-on-both path is tagged with its resolution policy.
 * Read-only inputs — the caller supplies `git diff --name-only` output; nothing is mutated.
 */
export function forecastZones(trunkFiles: readonly string[], laneFiles: readonly string[]): ConflictZone[] {
  const laneSet = new Set(laneFiles.map((f) => f.trim()).filter(Boolean));
  const seen = new Set<string>();
  const zones: ConflictZone[] = [];
  for (const raw of trunkFiles) {
    const f = raw.trim();
    if (!f || !laneSet.has(f) || seen.has(f)) continue;
    seen.add(f);
    zones.push({ path: f, policy: classifyConflict(f) });
  }
  return zones.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Pure: build the ordered convergence plan for ONE lane. Steps flagged `refWrite:true` are the
 * ones the (deferred, [T0]) executor would perform — the planner never runs them.
 */
export function planLane(
  lane: string,
  opts: { trunk: string; integration: string; remaining: readonly string[] },
): ConvergePlan {
  const { trunk, integration } = opts;
  const remaining = mergeOrder(opts.remaining.filter((l) => l !== lane));
  const steps: ConvergeStep[] = [
    { n: 1, kind: "merge", refWrite: true, detail: `merge ${trunk} → ${lane} (bring lane current)` },
    { n: 2, kind: "gate", refWrite: false, detail: `gate ${lane} (tsc --noEmit + vitest + security-gate)` },
    { n: 3, kind: "merge", refWrite: true, detail: `merge --no-ff ${lane} → ${integration}` },
    { n: 4, kind: "gate", refWrite: false, detail: `gate ${integration} (tsc --noEmit + vitest + security-gate)` },
    { n: 5, kind: "t0", refWrite: true, detail: `[T0] fast-forward ${trunk} → ${integration} (Emre approves)` },
  ];
  if (remaining.length > 0) {
    steps.push({
      n: 6,
      kind: "merge",
      refWrite: true,
      detail: `re-merge remaining lanes onto advanced ${trunk}: ${remaining.join(", ")}`,
    });
  }
  return { lane, trunk, integration, remaining, steps };
}

/**
 * Pure: render the git argv the DEFERRED ([T0] v1.30.3) executor would run for a plan. Returned
 * for preview/audit ONLY — converge.ts never executes these. `git add -A` is intentionally never
 * produced (staging is always path-scoped, decided at execute time).
 */
export function buildExecuteCommands(plan: ConvergePlan): string[][] {
  const { lane, trunk, integration, remaining } = plan;
  const cmds: string[][] = [
    ["git", "checkout", lane],
    ["git", "merge", "--no-edit", trunk],
    ["git", "checkout", integration],
    ["git", "merge", "--no-ff", "--no-edit", lane],
    // step 5 ([T0] fast-forward) is intentionally omitted from the auto-emitted argv — it is a
    // human-gated ref advance, not a scripted one.
  ];
  for (const r of remaining) {
    cmds.push(["git", "merge", "--no-edit", r]);
  }
  return cmds;
}

/** Pure: human-readable plan (console + markdown share this body). */
export function renderPlan(plan: ConvergePlan, zones: readonly ConflictZone[], trunkIsAncestor: boolean): string {
  const lines: string[] = [
    `converge (DRY-RUN — no ref written): lane=${plan.lane} trunk=${plan.trunk} integration=${plan.integration}`,
    `trunk⊑lane (up-to-date): ${trunkIsAncestor ? "yes" : "no — merge trunk→lane first"}`,
    "",
    "Plan:",
  ];
  for (const s of plan.steps) {
    lines.push(`  ${s.n}. [${s.kind}${s.refWrite ? " ✎ref" : ""}] ${s.detail}`);
  }
  lines.push("", `Conflict forecast (${zones.length} zone${zones.length === 1 ? "" : "s"}):`);
  if (zones.length === 0) {
    lines.push("  (none — no path changed on both trunk and lane since merge-base)");
  } else {
    for (const z of zones) lines.push(`  - ${z.path} → ${z.policy}`);
  }
  return lines.join("\n");
}

/** READ-ONLY git wrapper. Returns trimmed stdout, or "" on failure. Never mutates a ref. */
function git(args: readonly string[]): string {
  try {
    return execFileSync("git", args as string[], { cwd: REPO, encoding: "utf8", timeout: 15000 }).trim();
  } catch {
    return "";
  }
}

/** READ-ONLY ancestry probe: is `a` an ancestor of `b`? (git merge-base --is-ancestor, exit 0/1). */
function isAncestor(a: string, b: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: REPO, timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function parseFlag(argv: readonly string[], name: string): string | undefined {
  const pfx = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(pfx));
  return hit ? hit.slice(pfx.length) : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const execRequested = argv.includes("--execute");
  const positional = argv.filter((a) => !a.startsWith("-"));
  const lane = positional[0];

  if (!lane) {
    console.error("usage: converge.ts --dry-run <lane> [--trunk=<b>] [--integration=<b>] [--json]");
    process.exit(2);
  }

  const branches = git(["branch", "--format=%(refname:short)"]).split("\n").map((s) => s.trim()).filter(Boolean);
  const originHead = git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const trunk = parseFlag(argv, "trunk") ?? detectTrunk(branches, originHead);
  const integration = parseFlag(argv, "integration") ?? DEFAULT_INTEGRATION;
  const remaining = selectLanes(branches, trunk).filter((l) => l !== lane && l !== integration);

  const plan = planLane(lane, { trunk, integration, remaining });

  // Read-only conflict forecast: files touched on both sides since the merge-base.
  const mb = git(["merge-base", trunk, lane]);
  const trunkFiles = mb ? git(["diff", "--name-only", mb, trunk]).split("\n") : [];
  const laneFiles = mb ? git(["diff", "--name-only", mb, lane]).split("\n") : [];
  const zones = forecastZones(trunkFiles, laneFiles);
  const trunkIsAncestor = isAncestor(trunk, lane);

  if (execRequested) {
    // Execute path is implemented (buildExecuteCommands) but [T0]-gated → deferred to v1.30.3.
    // We PREVIEW the argv and refuse to run it — no ref is ever written by this tool.
    console.error("converge: --execute is [T0]-gated and deferred to v1.30.3 — printing NOT-RUN preview only.");
    for (const cmd of buildExecuteCommands(plan)) {
      console.error(`  [NOT-RUN] ${cmd.join(" ")}`);
    }
    console.error("  [NOT-RUN] step 5 [T0] fast-forward is human-approved, never scripted.");
    // Fall through to the dry-run report; still zero ref writes.
  }

  if (jsonOut) {
    console.log(JSON.stringify({ plan, zones, trunkIsAncestor }, null, 2));
    return;
  }
  console.log(renderPlan(plan, zones, trunkIsAncestor));
}

if (process.argv[1] && /converge\.ts$/.test(process.argv[1])) main();
