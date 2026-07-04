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
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractDiff, looksApplyable, targetFiles, classifyProposal, renderApplyReport, renderShipReport, riskTier, buildFleetCommitMsg, type ApplyRow, type ShipResult } from "./lib/fleet-apply";
import { parseSearchReplace, applyEdit, hasSearchReplace, type Edit } from "./lib/search-replace";
import { addedImportSpecifiers, importSpecifiers, isTypeOnlyRuntimeImport, isRelative } from "./lib/import-guard";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const WORK = join(homedir(), ".llm-mission-control", "fleet", "work");

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag("--apply");
const APPLY_ALL = argv.includes("--apply-all");
const JSON_OUT = argv.includes("--json");
// vO45 fleet-autonomy: auto-commit each gate-passing safe-auto proposal (sub-models' equivalent of the
// conductor grant — act without manual approval; the tsc+vitest gate stays). Race-safe: stage ONLY the
// proposal's own files, git reset first, NEVER `git add -A`.
const COMMIT = argv.includes("--commit");

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

/** Dry-resolve SEARCH/REPLACE edits against their target files (no write). Every edit must have a file that
 *  exists and a SEARCH that matches uniquely. Returns apply-readiness + touched files + reason. */
function drySearchReplace(edits: Edit[]): { ready: boolean; files: string[]; reason: string } {
  if (!edits.length) return { ready: false, files: [], reason: "no SEARCH/REPLACE blocks" };
  const files = new Set<string>();
  for (const e of edits) {
    if (!e.file) return { ready: false, files: [...files], reason: "SEARCH/REPLACE block missing a `### file:` target" };
    const abs = join(REPO, e.file);
    if (!existsSync(abs)) { // empty SEARCH → new file is fine
      if (e.search.trim() === "") { files.add(e.file); continue; }
      return { ready: false, files: [...files], reason: `target ${e.file} not found` };
    }
    const r = applyEdit(readFileSync(abs, "utf8"), e);
    if (!r.ok) return { ready: false, files: [...files], reason: `${e.file}: ${r.reason}` };
    files.add(e.file);
  }
  return { ready: true, files: [...files], reason: "search/replace resolves cleanly against the current tree" };
}

/** Extension candidates for resolving a relative import (TS lets a `.js` specifier resolve to `.ts`). */
const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];

/** Does a relative import `spec` resolve to a real file, given the importing file's absolute directory? */
function relativeImportExists(fromDirAbs: string, spec: string): boolean {
  const base = join(fromDirAbs, spec);
  const bases = base.endsWith(".js") ? [base, base.slice(0, -3) + ".ts"] : [base];
  for (const b of bases) for (const ext of RESOLVE_EXTS) if (existsSync(b + ext)) return true;
  return false;
}

/** STATIC guard for the "gate passes but `node` crashes" class: an edit that ADDS an import which cannot be
 *  loaded at runtime — a `.d.ts` type-only file used as a runtime module, or a relative import whose target
 *  does not exist. tsc treats a `.d.ts` import as type-only and vitest never executes an entry-point .mjs, so
 *  the gate is blind to this — we resolve it ourselves. Bare (package) specifiers are left to tsc. */
function importSafety(md: string): { safe: boolean; reason: string } {
  /** Check one added specifier from a file at `fileRel`. Returns an unsafe reason, or "" if fine. */
  const checkSpec = (spec: string, fileRel: string): string => {
    if (isTypeOnlyRuntimeImport(spec)) return `adds a runtime import of a type-only file (${spec}) → node crashes (ERR_MODULE_NOT_FOUND)`;
    if (isRelative(spec) && !relativeImportExists(dirname(join(REPO, fileRel)), spec)) return `adds an import of a missing module (${spec})`;
    return "";
  };
  if (hasSearchReplace(md)) {
    for (const e of parseSearchReplace(md)) {
      if (!e.file) continue;
      for (const spec of addedImportSpecifiers(e.search, e.replace)) {
        const bad = checkSpec(spec, e.file);
        if (bad) return { safe: false, reason: bad };
      }
    }
    return { safe: true, reason: "" };
  }
  // diff path: only `+` lines add imports; resolve against the first touched file.
  const diff = extractDiff(md);
  if (!diff) return { safe: true, reason: "" };
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
  const fileRel = targetFiles(diff)[0] ?? "";
  for (const spec of importSpecifiers(added)) {
    const bad = checkSpec(spec, fileRel);
    if (bad) return { safe: false, reason: bad };
  }
  return { safe: true, reason: "" };
}

/** Downgrade a row to `blocked` when it adds an unresolvable/runtime-broken import (the gate can't see it). */
function guardImports(md: string, row: ApplyRow): ApplyRow {
  const imp = importSafety(md);
  if (imp.safe) return row;
  return { ...row, tier: "blocked", reason: `${row.reason} · IMPORT-UNSAFE: ${imp.reason}` };
}

function collect(): ApplyRow[] {
  if (!existsSync(WORK)) return [];
  const rows: ApplyRow[] = [];
  for (const dir of readdirSync(WORK)) {
    const pf = join(WORK, dir, "PROPOSAL.md");
    if (!existsSync(pf)) continue;
    const [stream, slot = "?"] = dir.split(".");
    let md = ""; try { md = readFileSync(pf, "utf8"); } catch { continue; }
    if (hasSearchReplace(md)) {
      const sr = drySearchReplace(parseSearchReplace(md));
      rows.push(guardImports(md, { stream, slot, model: modelOf(md), hasDiff: true, applyReady: sr.ready, files: sr.files, reason: sr.reason, tier: riskTier(md, sr.files[0] ?? "") }));
      continue;
    }
    const diff = extractDiff(md);
    const applyOk = diff && looksApplyable(diff) ? gitApplyCheck(diff) : null;
    rows.push(guardImports(md, classifyProposal(stream, slot, modelOf(md), diff, applyOk)));
  }
  return rows.sort((a, b) => Number(b.applyReady) - Number(a.applyReady) || a.stream.localeCompare(b.stream));
}

/** Run the full gate (tsc + vitest). Throws on failure. */
function gate(): void {
  console.log(`[fleet-apply] gating (tsc + tests) …`);
  execFileSync(join(REPO, "node_modules/.bin/tsc"), ["--noEmit"], { cwd: REPO, stdio: "inherit" });
  execFileSync(join(REPO, "node_modules/.bin/vitest"), ["run"], { cwd: REPO, stdio: "inherit", timeout: 240000 });
}

/** Apply ONE apply-ready proposal (git-diff OR SEARCH/REPLACE), gate it, keep on GREEN else revert. Returns a
 *  result (no process.exit) so the batch driver can loop. Reverts by restoring each touched file's PRE-APPLY
 *  snapshot (not `git checkout`), so an earlier batch edit kept in the tree is never clobbered. */
function applyOne(target: string): { target: string; ok: boolean; files: string[]; reason: string } {
  const [stream, slot] = target.split(".");
  const pf = join(WORK, `${stream}.${slot}`, "PROPOSAL.md");
  if (!existsSync(pf)) return { target, ok: false, files: [], reason: "PROPOSAL.md yok" };
  const md = readFileSync(pf, "utf8");

  // Defense-in-depth: refuse a runtime-broken import BEFORE applying (the gate can't catch it) — so even a
  // single opt-in --apply won't ship the mjs-migration class. Static, no execution.
  const imp = importSafety(md);
  if (!imp.safe) return { target, ok: false, files: [], reason: `import-unsafe (${imp.reason}) — refused (gate can't catch this)` };

  // SEARCH/REPLACE path — deterministic exact-match apply (the reliable worker format).
  if (hasSearchReplace(md)) {
    const edits = parseSearchReplace(md);
    const dry = drySearchReplace(edits);
    if (!dry.ready) return { target, ok: false, files: [], reason: `apply-ready değil — ${dry.reason}` };
    const touched = dry.files;
    const snap = new Map<string, string | null>();
    for (const f of touched) { const abs = join(REPO, f); snap.set(f, existsSync(abs) ? readFileSync(abs, "utf8") : null); }
    console.log(`[fleet-apply] applying ${target} (search/replace) → ${touched.join(", ")} …`);
    for (const e of edits) { const abs = join(REPO, e.file!); const cur = existsSync(abs) ? readFileSync(abs, "utf8") : ""; writeFileSync(abs, applyEdit(cur, e).content); }
    try { gate(); return { target, ok: true, files: touched, reason: "applied + gate GREEN" }; }
    catch {
      for (const [f, c] of snap) { const abs = join(REPO, f); if (c === null) { try { unlinkSync(abs); } catch { /* was absent */ } } else writeFileSync(abs, c); }
      return { target, ok: false, files: touched, reason: "gate RED → reverted (snapshot restore)" };
    }
  }

  // git-diff path (vO51). `git apply -R` reverses only this patch → other batch edits untouched.
  const diff = extractDiff(md);
  if (!looksApplyable(diff) || !gitApplyCheck(diff)) return { target, ok: false, files: targetFiles(diff), reason: "apply-ready değil (illustrative/stale)" };
  const patch = join(tmpdir(), `fleet-apply-${stream}-${slot}.patch`);
  writeFileSync(patch, diff + "\n");
  console.log(`[fleet-apply] applying ${target} (git-diff) …`);
  try { execFileSync("git", ["apply", patch], { cwd: REPO, stdio: "ignore" }); }
  catch { return { target, ok: false, files: targetFiles(diff), reason: "git apply failed (conflicts with tree)" }; }
  try { gate(); return { target, ok: true, files: targetFiles(diff), reason: "applied + gate GREEN" }; }
  catch { try { execFileSync("git", ["apply", "-R", patch], { cwd: REPO, stdio: "ignore" }); } catch { /* best-effort */ } return { target, ok: false, files: targetFiles(diff), reason: "gate RED → reverted" }; }
}

/** --apply: single proposal (opt-in), keep-green/revert-red, exit-coded. */
function doApply(target: string): void {
  const r = applyOne(target);
  if (r.ok) { console.log(`\n✅ ${target} applied + gate GREEN — review \`git diff\` and commit if correct.`); return; }
  console.error(`\n✗ ${target}: ${r.reason}`); process.exit(1);
}

/**
 * vO45: commit ONE gate-passing proposal race-safely. `git reset` clears the index (drops any foreign
 * staged files — the race that bit the conductor twice), stages ONLY this proposal's own files, then
 * commits with author attribution. Returns the short hash on success, null if nothing committed / blocked.
 * NEVER `git add -A`.
 */
function commitShipped(stream: string, model: string, files: string[]): string | null {
  try {
    execFileSync("git", ["reset", "-q"], { cwd: REPO, stdio: "ignore" });
    const existing = files.filter((f) => existsSync(join(REPO, f)));
    if (!existing.length) return null;
    execFileSync("git", ["add", "--", ...existing], { cwd: REPO, stdio: "ignore" });
    // Nothing actually staged (e.g. no net change) → skip.
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: REPO, encoding: "utf8" }).trim();
    if (!staged) return null;
    execFileSync("git", ["commit", "-m", buildFleetCommitMsg(stream, model, existing)], { cwd: REPO, stdio: "ignore" });
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch { return null; } // pre-commit gate red / foreign-tree issue → leave applied-uncommitted, honest
}

/** --apply-all: batch gated-ship — every apply-ready SAFE-AUTO proposal, each independently gated, kept on
 *  green / reverted on red. review/blocked tiers are surfaced, never auto-applied. Left UNCOMMITTED for the
 *  conductor to review + commit. Writes FLEET_SHIP.md/.json. */
function doApplyAll(): void {
  const rows = collect();
  const eligible = rows.filter((r) => r.applyReady && r.tier === "safe-auto");
  const held = rows.filter((r) => r.applyReady && r.tier !== "safe-auto");
  console.log(`\nFLEET SHIP (batch) — ${eligible.length} safe-auto apply-ready · ${held.length} held (review/blocked):`);
  const shipped: ShipResult[] = [], reverted: ShipResult[] = [];
  for (const r of eligible) {
    const res = applyOne(`${r.stream}.${r.slot}`);
    const sr: ShipResult = { target: res.target, model: r.model, tier: r.tier, ok: res.ok, files: res.files, reason: res.reason };
    if (res.ok && COMMIT && res.files.length) {
      const committed = commitShipped(r.stream, r.model, res.files);
      sr.reason = committed ? `applied + gate GREEN + committed (${committed})` : "applied + gate GREEN (commit blocked — pre-commit gate/other)";
    }
    (res.ok ? shipped : reverted).push(sr);
    console.log(`  ${res.ok ? "✅ shipped" : "✗ reverted"}  ${res.target.padEnd(28)} ${sr.reason}`);
  }
  const skipped: ShipResult[] = held.map((r) => ({ target: `${r.stream}.${r.slot}`, model: r.model, tier: r.tier, ok: false, files: r.files, reason: r.tier === "blocked" ? "gate can't verify (shell/unknown target)" : "modifies existing logic — conductor must judge semantics" }));
  const ts = nowIso();
  writeFileSync(join(ORCH_DIR, "FLEET_SHIP.md"), renderShipReport(shipped, reverted, skipped, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "FLEET_SHIP.json"), JSON.stringify({ ts, shipped, reverted, skipped }, null, 2) + "\n");
  const committedN = COMMIT ? shipped.filter((s) => /committed \(/.test(s.reason)).length : 0;
  console.log(`\n${shipped.length} shipped${COMMIT ? ` (${committedN} committed)` : " (UNCOMMITTED)"} · ${reverted.length} reverted · ${skipped.length} skipped.`);
  if (shipped.length && !COMMIT) console.log(`Review: git diff — then commit. Ledger: orchestration/FLEET_SHIP.md`);
  else console.log(`Ledger: orchestration/FLEET_SHIP.md`);
}

function main(): void {
  if (APPLY_ALL) return doApplyAll();
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
