#!/usr/bin/env tsx
/**
 * orchestration/bin/lane-triage.ts — READ-ONLY triage of unmerged lane branches against the trunk.
 *
 * For every local lane branch (feat/ fix/ chore/ hmc/ integration/) it measures, using only
 * read-only git plumbing (rev-list / cherry / log — never merge/checkout/branch/push):
 *   - ahead      : commits on the lane not on trunk        (git rev-list --count trunk..lane)
 *   - behind     : commits on trunk not on the lane        (git rev-list --count lane..trunk)
 *   - unlanded   : cherry '+' — patch-id NOT present on trunk
 *   - landed     : cherry '-' — patch-id equivalent already on trunk (safe-to-drop signal)
 *   - age        : relative author/commit date of the lane tip (git log -1 --format=%cr)
 *
 * cherry semantics ≠ rev-list: a lane can be `ahead` yet fully `landed` (rebased/squashed onto
 * trunk under a new sha) — both columns are reported so the reader disambiguates. The `disposition`
 * column is intentionally left TBD; [T0] Emre fills it (merge / drop / rebase / archive).
 *
 * Output: orchestration/out/LANE_TRIAGE.md (table, ahead-DESC). Nothing is mutated in git.
 *
 * Run:  tsx orchestration/bin/lane-triage.ts [--json]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const OUT_FILE = join(ORCH_DIR, "out", "LANE_TRIAGE.md");

/** Branch-name prefixes that count as a "lane" for triage. */
export const LANE_PATTERN = /^(feat|fix|chore|hmc|integration)\//;

export interface LaneRow {
  lane: string;
  ahead: number;
  behind: number;
  unlanded: number;
  landed: number;
  age: string;
}

/** READ-ONLY git wrapper. Returns trimmed stdout, or "" on any failure (offline / bad ref). */
function git(args: readonly string[]): string {
  try {
    return execFileSync("git", args as string[], { cwd: REPO, encoding: "utf8", timeout: 15000 }).trim();
  } catch {
    return "";
  }
}

/** Pure: pick lane branches — pattern match, trunk excluded, deduped, stable order. */
export function selectLanes(branches: readonly string[], trunk: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of branches) {
    const b = raw.trim();
    if (!b || b === trunk) continue;
    if (!LANE_PATTERN.test(b)) continue;
    if (seen.has(b)) continue;
    seen.add(b);
    out.push(b);
  }
  return out;
}

/** Pure: count `git cherry` markers. '+' = unlanded (absent on trunk), '-' = landed (patch-id match). */
export function parseCherry(output: string): { unlanded: number; landed: number } {
  let unlanded = 0;
  let landed = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("+ ") || line === "+") unlanded++;
    else if (line.startsWith("- ") || line === "-") landed++;
  }
  return { unlanded, landed };
}

/** Pure: safe non-negative integer from a git count string (""/garbage → 0). */
export function toCount(s: string): number {
  const n = Number.parseInt(s.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Pure: ahead-DESC, then behind-DESC, then lane name — deterministic ordering. */
export function sortRows(rows: readonly LaneRow[]): LaneRow[] {
  return [...rows].sort((a, b) => b.ahead - a.ahead || b.behind - a.behind || a.lane.localeCompare(b.lane));
}

/** Pure: render the triage rows as a Markdown table (disposition column blank/TBD). */
export function renderTable(rows: readonly LaneRow[], trunk: string, generatedAt: string): string {
  const header = [
    "# LANE_TRIAGE",
    "",
    `Trunk: \`${trunk}\` · Lanes: ${rows.length} · Generated: ${generatedAt}`,
    "",
    "READ-ONLY. `git cherry`: `+`=absent-on-trunk, `-`=patch-id already landed. `ahead`/`behind` = rev-list counts.",
    "`disposition` is TBD — [T0] Emre fills (merge / rebase / drop / archive).",
    "",
    "| lane | ahead | behind | unlanded(+) | landed(-) | age | disposition |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  const body = rows.map(
    (r) => `| \`${r.lane}\` | ${r.ahead} | ${r.behind} | ${r.unlanded} | ${r.landed} | ${r.age || "?"} | TBD |`,
  );
  return [...header, ...body, ""].join("\n");
}

/** Detect the trunk: env override → feat/key-autonomy if present → origin/HEAD short → main. */
export function detectTrunk(branches: readonly string[], originHead: string): string {
  const env = process.env.OLLAMAS_TRUNK?.trim();
  if (env) return env;
  if (branches.includes("feat/key-autonomy")) return "feat/key-autonomy";
  const short = originHead.replace(/^refs\/remotes\/origin\//, "").trim();
  if (short && branches.includes(short)) return short;
  return "main";
}

function main(): void {
  const jsonOut = process.argv.includes("--json");
  const branches = git(["branch", "--format=%(refname:short)"]).split("\n").map((s) => s.trim()).filter(Boolean);
  const originHead = git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const trunk = detectTrunk(branches, originHead);
  const lanes = selectLanes(branches, trunk);

  const rows: LaneRow[] = lanes.map((lane) => {
    const ahead = toCount(git(["rev-list", "--count", `${trunk}..${lane}`]));
    const behind = toCount(git(["rev-list", "--count", `${lane}..${trunk}`]));
    const { unlanded, landed } = parseCherry(git(["cherry", trunk, lane]));
    const age = git(["log", "-1", "--format=%cr", lane]);
    return { lane, ahead, behind, unlanded, landed, age };
  });

  const sorted = sortRows(rows);
  const generatedAt = git(["log", "-1", "--format=%cI", "HEAD"]) || "unknown";

  if (jsonOut) {
    console.log(JSON.stringify({ trunk, lanes: sorted }, null, 2));
    return;
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, renderTable(sorted, trunk, generatedAt), "utf8");
  console.log(`lane-triage: trunk=${trunk} lanes=${sorted.length} → ${OUT_FILE}`);
  if (sorted.length > 0) {
    const top = sorted.slice(0, 5).map((r) => `${r.lane}(+${r.ahead})`).join(", ");
    console.log(`top-ahead: ${top}`);
  }
}

if (process.argv[1] && /lane-triage\.ts$/.test(process.argv[1])) main();
