/**
 * orchestration/bin/lib/claude-dispatch.ts — vO40 autonomous Claude Code session dispatch (PURE).
 *
 * Closes the act-gap in the autonomous loop: conduct/fuse DETECT the most critical requirement,
 * this module DECIDES whether to spawn a NEW Claude Code conductor session (plan mode) in a
 * fresh Terminal.app/iTerm2 tab to resolve it. Billing-runaway is impossible by construction:
 *   1. fingerprint idempotency — same requirement never spawns twice while a session is active
 *   2. active-session cap (default 1)
 *   3. cooldown between spawns (default 4h)
 *   4. kill-switch file + one-time activation marker + dry-run default (IO shell enforces)
 *   5. plan mode itself — the spawned session needs human plan-approval before code changes
 *
 * Pure: no IO, injected clock. IO shell = bin/claude-dispatch.ts.
 */
import { createHash } from "node:crypto";
import type { Requirement } from "./fuse";
import type { SpawnApp } from "./tab-spawn";

export interface DispatchSession {
  fingerprint: string;
  task: string;
  app: SpawnApp;
  startedTs: string;
  status: "active" | "done" | "stale";
}

/** Stable identity of a requirement — survives launchd re-fires and re-runs. */
export function taskFingerprint(req: Requirement): string {
  return createHash("sha256").update(`${req.criticality}:${req.target}:${req.action}`).digest("hex").slice(0, 12);
}

/** JSONL fold: last line per fingerprint wins (append-only ledger, LWW — claims.ts pattern). */
export function foldSessions(lines: string[]): DispatchSession[] {
  const byFp = new Map<string, DispatchSession>();
  for (const line of lines) {
    try {
      const s = JSON.parse(line);
      if (s && typeof s.fingerprint === "string" && s.status) byFp.set(s.fingerprint, s as DispatchSession);
    } catch { /* skip malformed line */ }
  }
  return [...byFp.values()];
}

/** Active sessions older than staleH are marked stale (crash/abandon recovery). Pure — returns changed ones. */
export function reconcileSessions(sessions: DispatchSession[], nowMs: number, staleH = 8): DispatchSession[] {
  const out: DispatchSession[] = [];
  for (const s of sessions) {
    if (s.status !== "active") continue;
    const t = Date.parse(s.startedTs);
    if (Number.isFinite(t) && (nowMs - t) / 3_600_000 > staleH) out.push({ ...s, status: "stale" });
  }
  return out;
}

export interface DispatchPlanInput {
  sessions: DispatchSession[];
  req: Requirement | null;
  nowMs: number;
  maxActive?: number;
  cooldownH?: number;
  killSwitch: boolean;
  goEnabled: boolean;
}
export interface DispatchPlan {
  go: boolean;
  mode: "spawn" | "dry" | "skip";
  reason: string;
  fingerprint?: string;
}

/** Single spawn/dry/skip decision. Guard order: safety gates first, activation last. */
export function planDispatch(i: DispatchPlanInput): DispatchPlan {
  const maxActive = i.maxActive ?? 1;
  const cooldownH = i.cooldownH ?? 4;
  if (i.killSwitch) return { go: false, mode: "skip", reason: "kill-switch aktif (.claude-dispatch-off)" };
  if (!i.req) return { go: false, mode: "skip", reason: "dispatch-edilecek kritik gereksinim yok" };
  const fp = taskFingerprint(i.req);
  const active = i.sessions.filter((s) => s.status === "active");
  if (active.some((s) => s.fingerprint === fp)) {
    return { go: false, mode: "skip", reason: `aynı görev zaten aktif (fingerprint ${fp})`, fingerprint: fp };
  }
  if (active.length >= maxActive) {
    return { go: false, mode: "skip", reason: `aktif oturum limiti dolu (${active.length}/${maxActive})`, fingerprint: fp };
  }
  const lastMs = Math.max(0, ...i.sessions.map((s) => Date.parse(s.startedTs)).filter(Number.isFinite));
  if (lastMs && (i.nowMs - lastMs) / 3_600_000 < cooldownH) {
    const left = Math.ceil(cooldownH - (i.nowMs - lastMs) / 3_600_000);
    return { go: false, mode: "skip", reason: `cooldown (${cooldownH}h) dolmadı — ~${left}h kaldı`, fingerprint: fp };
  }
  if (!i.goEnabled) {
    return { go: false, mode: "dry", reason: "dry-run — aktivasyon: touch orchestration/.claude-dispatch-enabled + --go", fingerprint: fp };
  }
  return { go: true, mode: "spawn", reason: `spawn: ${i.req.criticality}:${i.req.target}`, fingerprint: fp };
}

/** Conductor task prompt for the spawned Claude Code session (plan mode). Build EN (fleet doctrine). */
export function buildDispatchPrompt(req: Requirement, modelSelection: any, repo: string): string {
  const fp = taskFingerprint(req);
  const sel = modelSelection?.selection;
  const champs = modelSelection?.champions?.combination;
  const runtime = sel?.model
    ? `Optimal local runtime (live bench): \`${sel.model}\` @ ${sel.tokS ?? "?"} tok/s, num_ctx=${sel.config?.num_ctx ?? "?"}` +
      (champs?.implementer?.model ? `; champions implementer=\`${champs.implementer.model}\`, verifier=\`${champs.verifier?.model ?? "?"}\`` : "")
    : "Optimal local runtime: run `tsx orchestration/bin/benchprompt.ts` for a fresh MODEL_SELECTION.json";
  return [
    `You are the ollamas ORCHESTRA CONDUCTOR — a Claude Code session dispatched autonomously by the`,
    `orchestration pipeline (claude-dispatch vO40). Repo: ${repo}. Task fingerprint: ${fp}.`,
    ``,
    `MISSION — resolve the single most critical requirement the autonomous pipeline detected:`,
    `- criticality: ${req.criticality} (source: ${req.source}, score ${req.score})`,
    `- target: ${req.target}`,
    `- detail: ${req.detail}`,
    `- action: ${req.action}`,
    ``,
    `DOCTRINE (non-negotiable):`,
    `1. Invoke the \`fleet-orchestrator\` skill FIRST. You CONDUCT — you do not write feature code yourself.`,
    `2. You are in PLAN MODE: research the requirement (read orchestration/REQUIREMENTS.md + CONDUCTOR.md +`,
    `   QUALITY.md for context), then present a plan for approval before any change.`,
    `3. Distribute subtasks to the local model fleet: \`/council --debate\` for analysis decisions,`,
    `   \`/fleet --go\` for living agent-tabs, \`/think\` for recurring problems. ≤2 tasks/model, single-GPU FIFO.`,
    `4. ${runtime}.`,
    `5. Evidence only — no guessing. Every "works" claim = command output shown.`,
    `6. No half-work. Done means gated: tsc --noEmit 0 → vitest green (fresh run) → conventional commit.`,
    `7. PROPOSE-not-mutate: fleet worker output is gated by YOU before apply.`,
    ``,
    `COMPLETION PROTOCOL — when the requirement is verified resolved (gate green + committed), append`,
    `exactly one line to orchestration/seyir/claude-dispatch-state.jsonl so the pipeline can dispatch the`,
    `next requirement:`,
    `{"fingerprint":"${fp}","task":"${req.criticality}:${req.target}","app":"-","startedTs":"<now ISO>","status":"done"}`,
  ].join("\n");
}

/** Human-readable decision report (CLAUDE_DISPATCH.md body). Pure. */
export function renderDispatchMd(i: {
  ts: string; plan: DispatchPlan; req: Requirement | null; sessions: DispatchSession[];
  killSwitch: boolean; goEnabled: boolean; app: SpawnApp; reqStale?: boolean;
}): string {
  const icon = i.plan.mode === "spawn" ? "▶" : i.plan.mode === "dry" ? "[dry]" : "⏭";
  const L = [
    `# CLAUDE_DISPATCH.md — otonom Claude Code conductor spawn (vO40)`,
    ``,
    `> Auto: \`tsx orchestration/bin/claude-dispatch.ts [--go] [--app iterm2]\` · dry-run DEFAULT ·`,
    `> aktivasyon: \`touch orchestration/.claude-dispatch-enabled\` (tek sefer) · kill-switch: \`.claude-dispatch-off\``,
    ``,
    `## ${icon} ${i.plan.mode.toUpperCase()} — ${i.plan.reason}`,
    ``,
    `- ts: ${i.ts} · app: ${i.app} · go-enabled: ${i.goEnabled ? "✅" : "❌"} · kill-switch: ${i.killSwitch ? "🛑 ON" : "off"}${i.reqStale ? " · ⚠️ REQUIREMENTS bayat (spawn engellendi)" : ""}`,
    i.req
      ? `- top requirement: **${i.req.criticality}:${i.req.target}** — ${i.req.detail.slice(0, 100)} (fingerprint ${i.plan.fingerprint ?? "-"})`
      : `- top requirement: yok`,
    ``,
    `## Oturumlar`,
  ];
  if (!i.sessions.length) L.push(`- (henüz oturum yok)`);
  else {
    L.push(`| fingerprint | task | app | started | status |`, `|---|---|---|---|---|`);
    for (const s of i.sessions) L.push(`| ${s.fingerprint} | ${s.task} | ${s.app} | ${s.startedTs} | ${s.status} |`);
  }
  return L.join("\n");
}
