// tasklist (pure) — render the PERSISTENT master task list (docs/MASTER_TASKLIST.md).
//
// The operator's recurring master-directive is durable acceptance-criteria (not a scratch plan file).
// This renders: (A) the master-directive acceptance checklist, (B) the DONE log, (C) current codings
// status, (D) the next-task queue. The CLI feeds live data (git log, FLEET_NEXT, THINK, CODINGS_STATUS)
// so `docs/MASTER_TASKLIST.md` stays auto-refreshed (autopilot + /tasklist). IO-free → unit-tested.

export interface TaskListInputs {
  ts: string;
  doneLog: { ver: string; title: string; commit?: string }[]; // vO16→ history
  recentCommits: string[];                                     // last N `git log --oneline`
  codings: { done: number; total: number };                   // CODE_PLAN streams DONE/total
  next: { p1: number; total: number };                        // FLEET_NEXT queue
  think: { proven: number; needsResearch: number };           // THINK loop
  gateClean: boolean;                                          // full-repo gate green w/o GATE_SKIP
}

// The recurring master-directive as durable, checkable acceptance criteria (marked ✅ when the mechanism
// that satisfies it exists — evidence in BRAIN.md / CODINGS_STATUS.md).
export const ACCEPTANCE: { id: string; text: string; done: boolean; evidence: string }[] = [
  { id: "council", text: "Council: capability-matched multi-model analysis + oracle verify + debate", done: true, evidence: "orchestration/bin/council.ts, /council" },
  { id: "fleet-tabs", text: "Terminal.app + iTerm2 living agent-tabs, ≤2 tasks/model, stay open", done: true, evidence: "fleet-launch --go, fleet-agent (persistent + exec \\$SHELL)" },
  { id: "single-gpu", text: "Single-GPU truth: 1 local + N cloud, FIFO ticket-lock (starvation-free)", done: true, evidence: "gpu-lock.ts (Lamport bakery)" },
  { id: "always-open", text: "Always-open daemon: veri al/ver, görev al/ver, never exit", done: true, evidence: "fleet-conduct --watch (Monitor persistent)" },
  { id: "live-follow", text: "Live-follow system: .log + status, operator watches", done: true, evidence: "fleet-watch --watch + per-worker .log" },
  { id: "think", text: "Sustainable thinking loop: evidence-registry, no-guess, learns", done: true, evidence: "think.ts + PROBLEM_REGISTRY.json, /think" },
  { id: "plan-first", text: "Every worker plans before executing (## Plan:) + precomputes next (## Next:)", done: true, evidence: "fleet-agent taskPrompt" },
  { id: "native", text: "Native Claude Code: /slash + BRAIN.md + skill + lieutenant", done: true, evidence: ".claude/{commands,BRAIN.md,skills,agents}" },
  { id: "no-half", text: "No half-work: every coding gated (test = proof) or evidence-queued", done: true, evidence: "6/6 CODE_PLAN streams gated (CODINGS_STATUS.md)" },
  { id: "evidence", text: "Only evidence, no guessing: sources cited or NEEDS_RESEARCH", done: true, evidence: "PROBLEM_REGISTRY sources + THINK no-guess" },
  { id: "gate-clean", text: "e2e 100%: full-repo gate green with NO GATE_SKIP", done: false, evidence: "self-heal flaky fixed (6082ddc) — verify each commit" },
  { id: "report-tr", text: "Build EN, report TR", done: true, evidence: "all commits EN, reports TR" },
  { id: "e2e-loop", text: "End-to-end convergence loop: run autopilot until converged (bounded), detect convergence", done: true, evidence: "orchestration/bin/loop.ts + lib/loop.ts, /loop → docs/E2E_LOOP.md" },
  { id: "sequenced-mission", text: "Sequenced ethical mission: step-by-step (T1→Tn) dependency-ordered tasks, ≤2/model, tool-tier bounded (never privileged)", done: true, evidence: "orchestration/bin/mission.ts + lib/mission.ts, /mission → orchestration/MISSION.md" },
];

export function renderTaskList(i: TaskListInputs): string {
  // gate-clean ticks on the live gateClean flag (not its static `done`); all others on their `done`.
  const isTicked = (a: typeof ACCEPTANCE[number]) => a.id === "gate-clean" ? i.gateClean : a.done;
  const acc = ACCEPTANCE.map((a) => `- [${isTicked(a) ? "x" : " "}] **${a.id}** — ${a.text}  \n  ↳ ${a.evidence}`);
  const doneN = ACCEPTANCE.filter(isTicked).length;
  const L = [
    `# MASTER_TASKLIST.md — persistent task list (auto-generated, do not hand-edit)`,
    ``,
    `> Auto: \`tsx orchestration/bin/tasklist.ts\` · ${i.ts}. The operator's recurring master-directive as`,
    `> durable acceptance-criteria + live DONE/next. Refreshed by autopilot + \`/tasklist\`. Map: \`.claude/BRAIN.md\`.`,
    ``,
    `## A. Master-directive acceptance (${doneN}/${ACCEPTANCE.length})`,
    ...acc,
    ``,
    `## B. Current status`,
    `- CODE_PLAN streams: **${i.codings.done}/${i.codings.total} DONE** (docs/CODINGS_STATUS.md)`,
    `- THINK: ${i.think.proven} PROVEN · ${i.think.needsResearch} NEEDS_RESEARCH (PROBLEM_REGISTRY.json)`,
    `- Full-repo gate: ${i.gateClean ? "✅ green, NO GATE_SKIP" : "⚠️ needs GATE_SKIP (fix the flaky)"}`,
    ``,
    `## C. DONE log (vO history)`,
    ...i.doneLog.map((d) => `- ${d.ver} — ${d.title}${d.commit ? ` (\`${d.commit}\`)` : ""}`),
    ``,
    `## D. Next-task queue (${i.next.p1} P1 safe-additive · ${i.next.total} total) — see FLEET_NEXT.md`,
    ...i.recentCommits.slice(0, 5).map((c) => `- recent: ${c}`),
    ``,
    `> Convergence = all acceptance ✅ + gate clean + next-queue drained. This file is the durable source of`,
    `> truth across sessions; the plan file is scratch.`,
  ];
  return L.join("\n");
}
