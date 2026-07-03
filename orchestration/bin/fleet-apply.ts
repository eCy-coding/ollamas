#!/usr/bin/env tsx
/**
 * orchestration/bin/fleet-apply.ts — the conductor's apply-readiness triage for the fleet's gated proposals.
 * Reads every ~/.llm-mission-control/fleet/work/<stream>.<slot>/PROPOSAL.md, extracts its diff, dry-runs
 * `git apply --check` (read-only), and reports which proposals are apply-ready vs illustrative → FLEET_APPLY.md.
 *
 * With `--apply <stream>.<slot>` it applies ONE apply-ready proposal to the tree, runs the full gate
 * (tsc + tests), and keeps it only if green — otherwise reverts. The main tree is never left broken.
 *
 * Run:  tsx orchestration/bin/fleet-apply.ts            # triage (safe, read-only)
 *       tsx orchestration/bin/fleet-apply.ts --apply mjs-migration.terminal   # opt-in gated apply
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractDiff, looksApplyable, classifyProposal, renderApplyReport, type ApplyRow } from "./lib/fleet-apply";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const WORK = join(homedir(), ".llm-mission-control", "fleet", "work");

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag("--apply");
const JSON_OUT = argv.includes("--json");

const nowIso = () => { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } };

/** Model name from the PROPOSAL.md header line `# <stream> · <slot> · <model>`. */
function modelOf(md: string): string {
  const m = md.match(/^#\s*\S+\s*·\s*\S+\s*·\s*(.+)$/m);
  return m ? m[1].trim().replace(/\(.*/, "").trim() : "?";
}

/** git apply --check a diff via a temp patch file. Returns true when it applies cleanly to the current tree. */
function gitApplyCheck(diff: string): boolean {
  const patch = join(tmpdir(), `fleet-apply-${Math.abs(hash(diff))}.patch`);
  try { writeFileSync(patch, diff.endsWith("\n") ? diff : diff + "\n"); execFileSync("git", ["apply", "--check", patch], { cwd: REPO, stdio: "ignore" }); return true; }
  catch { return false; }
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function collect(): ApplyRow[] {
  if (!existsSync(WORK)) return [];
  const rows: ApplyRow[] = [];
  for (const dir of readdirSync(WORK)) {
    const pf = join(WORK, dir, "PROPOSAL.md");
    if (!existsSync(pf)) continue;
    const [stream, slot = "?"] = dir.split(".");
    let md = ""; try { md = readFileSync(pf, "utf8"); } catch { continue; }
    const diff = extractDiff(md);
    const applyOk = diff && looksApplyable(diff) ? gitApplyCheck(diff) : null;
    rows.push(classifyProposal(stream, slot, modelOf(md), diff, applyOk));
  }
  return rows.sort((a, b) => Number(b.applyReady) - Number(a.applyReady) || a.stream.localeCompare(b.stream));
}

/** --apply: apply ONE apply-ready proposal, gate it, keep on green else revert. */
function doApply(target: string): void {
  const [stream, slot] = target.split(".");
  const pf = join(WORK, `${stream}.${slot}`, "PROPOSAL.md");
  if (!existsSync(pf)) { console.error(`fleet-apply: ${target} PROPOSAL.md yok.`); process.exit(2); }
  const diff = extractDiff(readFileSync(pf, "utf8"));
  if (!looksApplyable(diff) || !gitApplyCheck(diff)) { console.error(`fleet-apply: ${target} apply-ready DEĞİL (illustrative/stale). Triage: tsx orchestration/bin/fleet-apply.ts`); process.exit(1); }
  const patch = join(tmpdir(), `fleet-apply-do.patch`);
  writeFileSync(patch, diff + "\n");
  console.log(`[fleet-apply] applying ${target} …`);
  execFileSync("git", ["apply", patch], { cwd: REPO, stdio: "inherit" });
  try {
    console.log(`[fleet-apply] gating (tsc + tests) …`);
    execFileSync(join(REPO, "node_modules/.bin/tsc"), ["--noEmit"], { cwd: REPO, stdio: "inherit" });
    execFileSync(join(REPO, "node_modules/.bin/vitest"), ["run"], { cwd: REPO, stdio: "inherit", timeout: 240000 });
    console.log(`\n✅ ${target} applied + gate GREEN — review \`git diff\` and commit if correct.`);
  } catch {
    console.error(`\n✗ gate FAILED after applying ${target} — reverting (main tree stays clean).`);
    try { execFileSync("git", ["apply", "-R", patch], { cwd: REPO, stdio: "ignore" }); } catch { /* best-effort reverse */ }
    process.exit(1);
  }
}

function main(): void {
  if (APPLY) return doApply(APPLY);
  const rows = collect();
  const ts = nowIso();
  writeFileSync(join(ORCH_DIR, "FLEET_APPLY.md"), renderApplyReport(rows, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "FLEET_APPLY.json"), JSON.stringify({ ts, rows }, null, 2) + "\n");
  if (JSON_OUT) { console.log(JSON.stringify({ ts, rows })); return; }
  const ready = rows.filter((r) => r.applyReady);
  console.log(`\nFLEET APPLY — ${ready.length}/${rows.length} proposal apply-ready:`);
  for (const r of rows) console.log(`  ${r.applyReady ? "✅" : "—"} ${`${r.stream}.${r.slot}`.padEnd(28)} ${r.reason}`);
  if (ready.length) console.log(`\nApply (gated): tsx orchestration/bin/fleet-apply.ts --apply ${ready[0].stream}.${ready[0].slot}`);
  console.log(`Rapor: orchestration/FLEET_APPLY.md`);
}

main();
