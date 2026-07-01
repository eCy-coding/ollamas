// fleet-next (pure) — compute the prioritized NEXT-TASK queue after a fleet round converges.
//
// Once the fleet has produced gated proposals, "what next?" is: APPLY them (real build). But applying is
// risk-tiered — an ADDITIVE proposal (new file, no edits to existing code) is safe to apply + gate now; a
// proposal that EDITS live code (server/host-bridge/start.sh) needs per-lane review first. NEEDS_RESEARCH
// items (from the THINK loop) are queued for research, never applied blind. This ranks that queue.
//
// IO-free → unit-tested. The CLI (bin/fleet-next.ts) feeds real proposals + think findings in.

export type NextKind = "apply-additive" | "apply-edit" | "research";
export interface ProposalRef { stream: string; slot: string; proposal: string; }
export interface NextTask {
  stream: string;
  kind: NextKind;
  priority: 1 | 2 | 3;   // 1 = safe additive apply, 2 = risky edit apply, 3 = research
  rationale: string;
  target: string;        // the file the diff touches (evidence anchor)
}

/** Extract the first file path the proposal's diff touches (evidence anchor). */
export function diffTarget(proposal: string): string {
  // prefer a real repo path after +++/---/scripts/server/cli, else first path-like token
  // alternation is longest-first so ".json" is not truncated to ".js"
  const m =
    /\+\+\+\s+(?:b\/)?([\w./-]+)/.exec(proposal) ||
    /([\w./-]+\.(?:tsx|json|mjs|ts|js|sh))\b/m.exec(proposal);
  return m ? m[1] : "(unknown)";
}

/** A proposal is ADDITIVE (safe) if its diff only adds a NEW file (/dev/null → path, or a "(new)" marker)
 *  and does not remove/replace existing lines. */
export function isAdditive(proposal: string): boolean {
  const editsExisting = /^-(?!--)/m.test(proposal);           // a real removed line (not the ---/+++ header)
  const newFile = /\/dev\/null|\(new\)|new file mode|^\+\/\//m.test(proposal) || /tsconfig\.json|\.test\.ts/.test(diffTarget(proposal));
  return newFile && !editsExisting;
}

/** Rank the next-task queue: safe-additive applies first, then risky edits, then research. Deterministic. */
export function prioritizeNext(proposals: ProposalRef[], researchProbes: string[] = []): NextTask[] {
  const fromProposals: NextTask[] = (proposals ?? []).map((p) => {
    const additive = isAdditive(p.proposal);
    return {
      stream: p.stream,
      kind: additive ? "apply-additive" : "apply-edit",
      priority: (additive ? 1 : 2) as 1 | 2,
      rationale: additive ? "new file, edits nothing existing → safe to apply + gate now" : "edits live code → per-lane review before apply (0-hata)",
      target: diffTarget(p.proposal),
    };
  });
  const fromResearch: NextTask[] = (researchProbes ?? []).map((probe) => ({
    stream: "(think)", kind: "research", priority: 3, rationale: "no proven solution yet → research ≥2 sources, then append to registry", target: probe.slice(0, 60),
  }));
  return [...fromProposals, ...fromResearch].sort((a, b) => a.priority - b.priority || a.stream.localeCompare(b.stream));
}

export function renderNext(queue: NextTask[], ts: string): string {
  const L = [
    `# FLEET_NEXT.md — prioritized next-task queue (precomputed)`,
    ``, `> Auto: \`tsx orchestration/bin/fleet-next.ts\` · ${ts} · ${queue.length} task`,
    `> Order: P1 safe-additive apply → P2 risky-edit apply (per-lane review) → P3 research (no-guess).`,
    ``, `| # | Task | Stream | Target | Rationale |`, `|---|------|--------|--------|-----------|`,
  ];
  queue.forEach((t, i) => L.push(`| ${i + 1} | P${t.priority} ${t.kind} | ${t.stream} | \`${t.target}\` | ${t.rationale} |`));
  const p1 = queue.filter((t) => t.priority === 1);
  L.push(``, `## Conductor directive (next)`);
  if (p1.length) L.push(`- Apply the ${p1.length} P1 safe-additive task(s) now through the full gate (tsc → vitest → commit): ${p1.map((t) => t.target).join(", ")}`);
  else L.push(`- No safe-additive task; P2 edits need per-lane review, P3 needs research. Nothing to blind-apply.`);
  return L.join("\n");
}
