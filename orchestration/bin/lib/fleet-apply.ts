// fleet-apply (pure) — the conductor's apply-readiness triage for the fleet's gated PROPOSAL.md files.
// IO-free → unit-tested; the CLI reads the proposals, runs `git apply --check`, and can opt-in apply one.
//
// Why: the fleet PRODUCES gated proposals (Change/Diff/Test) but nothing APPLIES them — the produce→gate→
// APPLY loop is open. Most worker diffs are ILLUSTRATIVE (no real line-numbers), so a blind apply would
// fail. This module extracts the diff, judges whether it even LOOKS applyable, and (with the CLI's dry
// `git apply --check`) classifies each proposal apply-ready vs illustrative — so the conductor applies only
// clean, correct patches, gated. No blind application of weak-model output.

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
  return { stream, slot, model, hasDiff, applyReady, files: hasDiff ? targetFiles(diff) : [], reason };
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
    `| Stream/slot | Model | Diff | Apply-ready | Files | Reason |`,
    `|-------------|-------|------|-------------|-------|--------|`,
    ...rows.map((r) => `| ${r.stream}.${r.slot} | \`${r.model}\` | ${r.hasDiff ? "✅" : "—"} | ${r.applyReady ? "**✅**" : "—"} | ${r.files.join(", ") || "—"} | ${r.reason} |`),
    ``,
    `## Apply-ready (conductor may \`--apply\`, gated)`,
    ...(ready.length ? ready.map((r) => `- \`${r.stream}.${r.slot}\` (${r.model}) → ${r.files.join(", ")} — \`tsx orchestration/bin/fleet-apply.ts --apply ${r.stream}.${r.slot}\``) : ["- (none — all proposals are illustrative; workers must emit clean unified diffs with real line numbers)"]),
  ];
  return L.join("\n");
}
