// fleet-apply (pure) — the conductor's apply-readiness triage for the fleet's gated PROPOSAL.md files.
// IO-free → unit-tested; the CLI reads the proposals, runs `git apply --check`, and can opt-in apply one.
//
// Why: the fleet PRODUCES gated proposals (Change/Diff/Test) but nothing APPLIES them — the produce→gate→
// APPLY loop is open. Most worker diffs are ILLUSTRATIVE (no real line-numbers), so a blind apply would
// fail. This module extracts the diff, judges whether it even LOOKS applyable, and (with the CLI's dry
// `git apply --check`) classifies each proposal apply-ready vs illustrative — so the conductor applies only
// clean, correct patches, gated. No blind application of weak-model output.
//
// Risk-tier: apply-ready ≠ ship-ready. A shaped edit can still PASS the gate yet be semantically wrong (e.g.
// wrapping POST calls in a single-flight collapses distinct side-effects — tsc/tests won't catch it). So the
// batch ship auto-applies ONLY the `safe-auto` tier (purely additive edits in gate-covered TS/mjs); edits that
// modify existing logic → `review` (conductor eyeballs), and non-gate-covered targets (.sh/.md/unknown) →
// `blocked` (the gate can't verify them). Deterministic, IO-free.

import { isAdditive } from "./fleet-next";
import { hasSearchReplace, parseSearchReplace } from "./search-replace";

export type RiskTier = "safe-auto" | "review" | "blocked";

/** Files the tsc + vitest gate can actually verify (type-checked / test-covered). */
const GATE_COVERED = /\.(tsx?|mjs|cts|mts)$/;

/** Additive = nothing removed. Diff form: reuse fleet-next.isAdditive. SEARCH/REPLACE form: every block's
 *  REPLACE keeps the SEARCH verbatim (new lines only) or SEARCH is empty (new file). */
export function proposalIsAdditive(proposal: string): boolean {
  if (hasSearchReplace(proposal)) {
    const edits = parseSearchReplace(proposal);
    return edits.length > 0 && edits.every((e) => e.search === "" || e.replace.includes(e.search));
  }
  return isAdditive(proposal);
}

/** Risk tier for auto-ship gating. `safe-auto` = additive AND gate-covered target; `review` = modifies
 *  existing logic in a gate-covered file (gate catches type/test breaks, conductor judges semantics);
 *  `blocked` = target the gate cannot verify (.sh/.md/unknown) → never auto-shipped. */
export function riskTier(proposal: string, target: string): RiskTier {
  if (!target || target === "(unknown)" || !GATE_COVERED.test(target)) return "blocked";
  return proposalIsAdditive(proposal) ? "safe-auto" : "review";
}

/** Extract the FIRST fenced ```diff block from a PROPOSAL.md (workers sometimes duplicate it). */
export function extractDiff(proposalMd: string): string {
  const m = proposalMd.match(/```diff\s*\n([\s\S]*?)```/);
  if (!m) return "";
  return m[1].replace(/\s+$/, "");
}

/** A diff LOOKS applyable when it has a `diff --git`/`---`/`+++` header AND either a proper `@@ -a,b +c,d @@`
 *  hunk (real line numbers) or a `new file mode` (whole-file add). An `@@` with no numbers is illustrative. */
export function looksApplyable(diff: string): boolean {
  if (!diff.trim()) return false;
  const hasHeader = /(^|\n)(diff --git |--- |\+\+\+ )/.test(diff);
  if (!hasHeader) return false;
  const newFile = /\nnew file mode /.test(diff) || /\n--- \/dev\/null/.test(diff);
  const numberedHunk = /\n@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(diff);
  return newFile || numberedHunk;
}

/** The target files a diff touches (from `+++ b/…` / `--- a/…`, ignoring /dev/null). */
export function targetFiles(diff: string): string[] {
  const out = new Set<string>();
  for (const m of diff.matchAll(/\n\+\+\+ (?:b\/)?(\S+)/g)) if (m[1] !== "/dev/null") out.add(m[1]);
  for (const m of diff.matchAll(/\ndiff --git a\/\S+ b\/(\S+)/g)) out.add(m[1]);
  return [...out];
}

export interface ApplyRow {
  stream: string;
  slot: string;
  model: string;
  hasDiff: boolean;
  applyReady: boolean;   // looksApplyable AND `git apply --check` passed (the CLI supplies applyOk)
  files: string[];
  reason: string;
  tier: RiskTier;        // safe-auto (batch auto-ships) | review (conductor judges) | blocked (gate can't verify)
}

/** Classify one proposal. `applyOk` is the result of the CLI's `git apply --check` (null if not run). */
export function classifyProposal(stream: string, slot: string, model: string, diff: string, applyOk: boolean | null): ApplyRow {
  const hasDiff = !!diff.trim();
  const shaped = hasDiff && looksApplyable(diff);
  const applyReady = shaped && applyOk === true;
  const reason = !hasDiff ? "no diff block"
    : !shaped ? "illustrative diff (no real line-numbers / new-file marker) — not machine-applyable"
      : applyOk === false ? "diff shaped but `git apply --check` failed (stale vs current tree)"
        : applyOk === null ? "shaped; not checked"
          : "clean — applies to the current tree";
  const files = hasDiff ? targetFiles(diff) : [];
  return { stream, slot, model, hasDiff, applyReady, files, reason, tier: riskTier(diff, files[0] ?? "") };
}

export interface ShipResult { target: string; model: string; tier: RiskTier; ok: boolean; files: string[]; reason: string }

/** Render FLEET_SHIP.md: the batch gated-ship ledger — what auto-shipped (gate GREEN, left uncommitted for
 *  conductor review), what reverted (gate RED), and what was skipped (review/blocked, needs a human). */
export function renderShipReport(shipped: ShipResult[], reverted: ShipResult[], skipped: ShipResult[], ts: string): string {
  const row = (r: ShipResult) => `| ${r.target} | \`${r.model}\` | ${r.tier} | ${r.files.join(", ") || "—"} | ${r.reason} |`;
  return [
    `# FLEET_SHIP.md — batch gated-ship ledger (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/fleet-apply.ts --apply-all\` · ${ts}. Applies every apply-ready **safe-auto**`,
    `> proposal (additive, gate-covered), each gated independently (tsc + vitest): kept on GREEN, reverted on RED.`,
    `> Left UNCOMMITTED — the conductor reviews \`git diff\` and commits. \`review\`/\`blocked\` tiers are NOT`,
    `> auto-shipped (semantic risk / gate can't verify) — apply them one-by-one with \`--apply <stream>.<slot>\`.`,
    ``,
    `## Result: ${shipped.length} shipped · ${reverted.length} reverted · ${skipped.length} skipped`,
    ``,
    `| Target | Model | Tier | Files | Outcome |`,
    `|--------|-------|------|-------|---------|`,
    ...shipped.map(row),
    ...reverted.map(row),
    ...skipped.map(row),
    ``,
    ...(shipped.length ? [`## Shipped (uncommitted — review \`git diff\` then commit)`, ...shipped.map((r) => `- \`${r.target}\` → ${r.files.join(", ")}`)] : [`## Nothing auto-shipped this pass`]),
    ...(skipped.length ? [``, `## Skipped (conductor must judge — \`--apply <stream>.<slot>\`)`, ...skipped.map((r) => `- \`${r.target}\` (${r.tier}) → ${r.reason}`)] : []),
  ].join("\n");
}

/** Render FLEET_APPLY.md: which model proposals are apply-ready vs illustrative, with reasons. */
export function renderApplyReport(rows: ApplyRow[], ts: string): string {
  const ready = rows.filter((r) => r.applyReady);
  const L: string[] = [
    `# FLEET_APPLY.md — conductor apply-readiness triage (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/fleet-apply.ts\` · ${ts}. Extracts each gated proposal's diff and dry-runs`,
    `> \`git apply --check\`. "Apply-ready" = a shaped diff (real line-numbers or new-file) that applies to the`,
    `> current tree. The conductor applies only these (opt-in, gated); illustrative diffs are surfaced, not applied.`,
    ``,
    `## Result: ${ready.length}/${rows.length} proposals apply-ready`,
    ``,
    `| Stream/slot | Model | Diff | Apply-ready | Tier | Files | Reason |`,
    `|-------------|-------|------|-------------|------|-------|--------|`,
    ...rows.map((r) => `| ${r.stream}.${r.slot} | \`${r.model}\` | ${r.hasDiff ? "✅" : "—"} | ${r.applyReady ? "**✅**" : "—"} | ${r.tier} | ${r.files.join(", ") || "—"} | ${r.reason} |`),
    ``,
    `## Apply-ready (conductor may \`--apply\`, gated)`,
    ...(ready.length ? ready.map((r) => `- \`${r.stream}.${r.slot}\` (${r.model}) → ${r.files.join(", ")} — \`tsx orchestration/bin/fleet-apply.ts --apply ${r.stream}.${r.slot}\``) : ["- (none — all proposals are illustrative; workers must emit clean unified diffs with real line numbers)"]),
  ];
  return L.join("\n");
}
