// L47 — the orchestra's health at a glance, derived from evidence.
//
// status.md was a sync-time snapshot of the four systems, but it could not answer the
// question that actually matters: is the orchestra useful? How often does a task reach a
// grounded answer, which member carries the work, how often does measured quality overrule the
// gate, what is waiting on a human? Those live in the outcome ledger and the board, and this
// derives them — purely, so the panel can be tested without a running stack.
import type { TaskOutcome, StepRole, Board } from "./orchestra-tasks";

export interface MemberStat {
  role: StepRole;
  /** Tasks this member contributed something to. */
  contributed: number;
  /** Tasks this member's synthesis won (expert === role's system). */
  won: number;
}

export interface OrchestraPanel {
  total: number;
  answered: number;
  /** answered / total, 0..1. */
  answerRate: number;
  avgRounds: number;
  vetoes: number;
  /** Distinct members by contribution count. */
  members: { name: string; contributed: number }[];
  /** Expert → wins. */
  winners: Record<string, number>;
  /** Titles sitting in Doing awaiting approval. */
  pendingApprovals: string[];
  /** Titles frozen because they waited too long (L47 stale-freeze). */
  frozen: string[];
}

/** Read the outcome ledger (JSONL). Best-effort — a malformed line is skipped, not fatal. */
export function readOutcomes(text: string, limit = 50): TaskOutcome[] {
  const rows: TaskOutcome[] = [];
  for (const line of String(text ?? "").trim().split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip a bad line */ }
  }
  return rows.slice(-limit);
}

/**
 * Derive the panel from the recent outcome ledger and the current board. PURE.
 *
 * The ledger is the source of truth for "what happened"; the board tells us what is waiting.
 * Members are counted by contribution so obsidian being offline (no vault contributions) shows
 * as a low number rather than being invisible.
 */
export function orchestraPanel(outcomes: TaskOutcome[], board: Board): OrchestraPanel {
  const total = outcomes.length;
  const answered = outcomes.filter((o) => o.answered).length;
  const vetoes = outcomes.filter((o) => o.vetoed).length;
  const avgRounds = total ? Number((outcomes.reduce((a, o) => a + (o.rounds ?? 1), 0) / total).toFixed(2)) : 0;

  const contribByRole = new Map<StepRole, number>();
  const winners: Record<string, number> = {};
  for (const o of outcomes) {
    for (const m of o.members ?? []) contribByRole.set(m, (contribByRole.get(m) ?? 0) + 1);
    if (o.answered && o.expert) winners[o.expert] = (winners[o.expert] ?? 0) + 1;
  }
  // Role → human-facing member name, matching the role cards.
  const NAME: Record<StepRole, string> = { command: "eCym", recall: "ollamas", vault: "obsidian" };
  const members = (["recall", "command", "vault"] as StepRole[]).map((r) => ({
    name: NAME[r], contributed: contribByRole.get(r) ?? 0,
  }));

  // Pending approvals: Doing lines still unchecked. Frozen ones carry the ❄️ marker (L47).
  const doing = board.lanes.Doing.filter((l) => /^\s*-\s*\[ \]/.test(l));
  const titleOf = (l: string) => l.replace(/^\s*-\s*\[[ x]\]\s*/, "").replace(/^❄️\s*/, "").trim();
  const frozen = doing.filter((l) => l.includes("❄️")).map(titleOf);
  const pendingApprovals = doing.map(titleOf);

  return {
    total, answered, answerRate: total ? Number((answered / total).toFixed(2)) : 0,
    avgRounds, vetoes, members, winners, pendingApprovals, frozen,
  };
}

/** Render the panel as the markdown block appended to status.md. */
export function renderPanel(p: OrchestraPanel): string {
  const memberRows = p.members
    .map((m) => `| ${m.name} | ${m.contributed} katkı | ${p.winners[m.name] ?? 0} kazanma |`)
    .join("\n");
  return `## 🎼 Orkestra görev metrikleri\n\n`
    + `> [!abstract] Son ${p.total} görev · cevap oranı **%${Math.round(p.answerRate * 100)}** · ort. tur ${p.avgRounds} · veto ${p.vetoes}\n\n`
    + `| Üye | Katkı | Kazanma |\n|---|---|---|\n${memberRows || "| _(görev yok)_ | | |"}\n\n`
    + (p.pendingApprovals.length
        ? `> [!warning] ⏳ Bekleyen onay (${p.pendingApprovals.length}): ${p.pendingApprovals.map((t) => `\`${t}\``).join(", ")}\n`
          + (p.frozen.length ? `> [!error] ❄️ Donmuş (${p.frozen.length}): ${p.frozen.map((t) => `\`${t}\``).join(", ")}\n` : "")
        : `> [!success] Bekleyen onay yok.\n`)
    + `\n[[Orchestra]] · [[runs]]\n`;
}
