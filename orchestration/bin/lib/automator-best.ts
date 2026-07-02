// automator-best (pure) — score, rank and package the vO37 daily-loop's per-model recurring automations
// into a single install-ready "best" bundle. IO-free → unit-tested (the CLI does validation + file copy).
//
// Why: the daily loop produces N separate per-model recurring automations; none is validated or installed,
// so the output isn't "ready to use". This selects the best-COVERED one (plist + script + README, launchd
// schedule, most files), the CLI validates it (plutil -lint + bash -n, no execution) and copies it to a
// BEST/ bundle with a one-command install README — turning the loop output into something usable.

import type { DailyRow } from "./automator-probe";

/** Score one automation. 0 unless it's a real recurring (scheduled) automation. Rewards kind-coverage
 *  (a complete bundle = plist + script + README), file count, and a launchd mechanism. Deterministic. */
export function scoreAutomation(row: DailyRow): number {
  if (!row.scheduled) return 0;
  const has = (k: string) => ((row.kinds as string[]).includes(k) ? 1 : 0);
  let s = 10;                                  // base for being recurring at all
  s += has("plist") * 4;                       // the schedule carrier (most important)
  s += has("shell") * 3;                       // the maintenance script it runs
  s += has("readme") * 2;                      // install/usage docs
  s += Math.min(row.fileCount, 4);             // completeness, capped
  if (row.mechanism === "launchd") s += 2;     // native macOS schedule (repo standard) over cron/calendar
  return s;
}

/** Rank the recurring automations best-first. Non-recurring are dropped. Stable: equal scores keep input
 *  order (so a deterministic, reproducible winner). */
export function rankAutomations(rows: DailyRow[]): DailyRow[] {
  return rows
    .filter((r) => r.scheduled)
    .map((r, i) => ({ r, i, s: scoreAutomation(r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ r }) => r);
}

/** The one-command install for a bundled LaunchAgent: copy the plist into ~/Library/LaunchAgents and load it. */
export function installCommand(plistName: string): string {
  return `cp ~/Desktop/ollamas-daily/BEST/${plistName} ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/${plistName}`;
}

export interface Validation { ok: boolean; plist: string; script: string; detail: string }

export interface BestPick { row: DailyRow; score: number; validation: Validation }

/** Render the ranking + winner + validation + install command → AUTOMATOR_BEST.md. */
export function renderBestReport(ranked: DailyRow[], winner: BestPick | null, ts: string): string {
  const L: string[] = [
    `# AUTOMATOR_BEST.md — best install-ready daily automation (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/automator-best.ts\` · ${ts}. Ranks the daily-loop's recurring automations,`,
    `> validates the top candidates (plutil -lint + bash -n — syntax only, never executed) and packages the`,
    `> best VALID one into \`~/Desktop/ollamas-daily/BEST/\` with a one-command install. Nothing is installed`,
    `> or run — \`launchctl load\` stays the operator's explicit choice.`,
    ``,
  ];
  if (winner) {
    L.push(
      `## Winner: \`${winner.row.model}\` (score ${winner.score}, ${winner.validation.ok ? "✅ validated" : "⚠️ validation issues"})`,
      ``,
      `- Files: ${winner.row.artifacts.map((a) => `\`${a.name}\` [${a.kind}]`).join(", ")}`,
      `- Mechanism: ${winner.row.mechanism} · validation: ${winner.validation.detail}`,
      ``,
      `### Install (one command)`,
      "```bash",
      installCommand(winner.row.artifacts.find((a) => a.kind === "plist")?.name ?? "com.ollamas.daily.plist"),
      "```",
      ``,
    );
  } else {
    L.push(`## Winner: (none) — no recurring automation passed validation`, ``);
  }
  L.push(
    `## Ranking — who produced what (${ranked.length} recurring)`,
    ``,
    `| # | Model | Score | Mechanism | Files | Kinds |`,
    `|---|-------|-------|-----------|-------|-------|`,
    ...ranked.map((r, i) => `| ${i + 1} | \`${r.model}\` | ${scoreAutomation(r)} | ${r.mechanism} | ${r.fileCount} | ${r.kinds.join(", ")} |`),
  );
  return L.join("\n");
}
