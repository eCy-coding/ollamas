/**
 * orchestration/bin/lib/claude-dispatch.ts — vO40/vO41 autonomous Claude Code session dispatch (PURE).
 *
 * vO40: closes the act-gap — conduct/fuse DETECT the most critical requirement, this module DECIDES
 * whether to spawn a NEW Claude Code conductor session (plan mode) in a fresh Terminal.app/iTerm2 tab.
 * vO41: continuous chain — one task ends → next begins, per researched loop-engineering law:
 * max-iteration cap + budget cap + agent-evaluable SUCCESS FUNCTION + escalation path (all four,
 * missing one = runaway).
 *
 * Guard layers (billing-runaway impossible by construction):
 *   1. fingerprint idempotency — same requirement never spawns twice while a session is active
 *      (fingerprint = target:action, criticality EXCLUDED: tier de-escalation must not forge identity)
 *   2. active-session cap (default 1) + rolling-24h spawn budget (default 6)
 *   3. failure backoff — cooldown ONLY after a stale (crashed/abandoned) session; done chains instantly
 *   4. escalation — 2× stale on the same requirement → blocked (human needed), never respawned
 *   5. kill-switch file + one-time activation marker + dry-run default (IO shell enforces)
 *   6. plan mode itself — the spawned session needs human plan-approval before code changes
 *
 * SUCCESS FUNCTION (evidence-based completion): a requirement that disappears from FRESH, NON-EMPTY
 * REQUIREMENTS.json is resolved — the pipeline itself verifies, no honor-system dependency.
 *
 * Pure: no IO, injected clock. IO shell = bin/claude-dispatch.ts.
 */
import { createHash } from "node:crypto";
import type { Requirement } from "./fuse";
import type { SpawnApp } from "./tab-spawn";

export type SessionStatus = "active" | "done" | "stale" | "blocked";

export interface DispatchSession {
  fingerprint: string;
  task: string;
  target?: string; // vO41+; older ledger lines derive it from task
  app: SpawnApp | "-";
  startedTs: string;
  status: SessionStatus;
}

/** Stable identity — criticality EXCLUDED (tier flip on same target must not change identity, vO41). */
export function taskFingerprint(req: Requirement): string {
  return createHash("sha256").update(`${req.target}:${req.action}`).digest("hex").slice(0, 12);
}

/** Session's requirement-target; vO40 ledger lines lack `target` → derive from task "CRIT:target". */
export function sessionTarget(s: DispatchSession): string {
  return s.target ?? s.task.split(":").slice(1).join(":");
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

/**
 * vO41 SUCCESS FUNCTION — evidence-based completion: active session whose TARGET is no longer among
 * fresh REQUIREMENTS targets → done (pipeline no longer detects the requirement = resolved).
 * Guards: only on FRESH (<60min) AND NON-EMPTY requirements (fuse-crash → no mass-done storm),
 * and session ≥ minAgeMin old (another-lane-fixed race → cap-bypass prevention).
 */
export function autoCompleteSessions(
  sessions: DispatchSession[], freshTargets: Set<string>,
  o: { reqsFresh: boolean; reqsNonEmpty: boolean; nowMs: number; minAgeMin?: number },
): DispatchSession[] {
  if (!o.reqsFresh || !o.reqsNonEmpty) return [];
  const minAge = (o.minAgeMin ?? 30) * 60_000;
  const out: DispatchSession[] = [];
  for (const s of sessions) {
    if (s.status !== "active") continue;
    const t = Date.parse(s.startedTs);
    if (!Number.isFinite(t) || o.nowMs - t < minAge) continue;
    if (!freshTargets.has(sessionTarget(s))) out.push({ ...s, status: "done" });
  }
  return out;
}

/** Escalation input: how many times each fingerprint went stale (raw append-only lines = history). */
export function staleCounts(rawLines: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of rawLines) {
    try {
      const s = JSON.parse(line);
      if (s?.status === "stale" && typeof s.fingerprint === "string") out.set(s.fingerprint, (out.get(s.fingerprint) ?? 0) + 1);
    } catch { /* skip */ }
  }
  return out;
}

/** Rolling-window spawn budget: only `active` lines COUNT (completions must not consume budget). */
export function spawnsInWindow(rawLines: string[], nowMs: number, windowH = 24): number {
  let n = 0;
  for (const line of rawLines) {
    try {
      const s = JSON.parse(line);
      if (s?.status !== "active") continue;
      const t = Date.parse(s.startedTs);
      if (Number.isFinite(t) && nowMs - t <= windowH * 3_600_000) n++;
    } catch { /* skip */ }
  }
  return n;
}

/** Audit-churn guard: identical consecutive entry (action+fingerprint+reason) → don't write again. */
export function shouldAudit(lastLine: string | undefined, e: { action: string; fingerprint?: string | null; reason?: string }): boolean {
  if (!lastLine) return true;
  try {
    const last = JSON.parse(lastLine);
    return !(last.action === e.action && (last.fingerprint ?? null) === (e.fingerprint ?? null) && (last.reason ?? "") === (e.reason ?? ""));
  } catch { return true; }
}

export interface DispatchPlanInput {
  sessions: DispatchSession[];
  req: Requirement | null;
  nowMs: number;
  maxActive?: number;
  cooldownH?: number;
  killSwitch: boolean;
  goEnabled: boolean;
  // vO41 chain inputs
  lastStatus?: SessionStatus;   // LWW status of the most recently started session
  spawns24h?: number;           // spawnsInWindow() result
  maxPerDay?: number;           // rolling-24h budget (default 6)
  staleCountForReq?: number;    // staleCounts().get(fingerprint) for THIS requirement
  maxStale?: number;            // escalation threshold (default 2)
  candidateStable?: boolean;    // vO44 churn-guard: isStableCandidate() result (default true)
}
export interface DispatchPlan {
  go: boolean;
  mode: "spawn" | "dry" | "skip" | "blocked";
  reason: string;
  fingerprint?: string;
}

/**
 * Single spawn/dry/skip decision. Guard order (vO41):
 * kill → no-req → escalation(blocked) → dup-active(by TARGET) → cap → 24h-budget →
 * cooldown(ONLY after stale = failure backoff; done chains instantly) → activation.
 */
export function planDispatch(i: DispatchPlanInput): DispatchPlan {
  const maxActive = i.maxActive ?? 1;
  const cooldownH = i.cooldownH ?? 4;
  const maxPerDay = i.maxPerDay ?? 6;
  const maxStale = i.maxStale ?? 2;
  if (i.killSwitch) return { go: false, mode: "skip", reason: "kill-switch aktif (.claude-dispatch-off)" };
  if (!i.req) return { go: false, mode: "skip", reason: "dispatch-edilecek kritik gereksinim yok" };
  const fp = taskFingerprint(i.req);
  if ((i.staleCountForReq ?? 0) >= maxStale) {
    return { go: false, mode: "blocked", reason: `escalation: ${i.staleCountForReq}× stale — insan müdahalesi gerekli (${i.req.target})`, fingerprint: fp };
  }
  const active = i.sessions.filter((s) => s.status === "active");
  if (active.some((s) => sessionTarget(s) === i.req!.target)) {
    return { go: false, mode: "skip", reason: `aynı görev zaten aktif (${i.req.target})`, fingerprint: fp };
  }
  if (active.length >= maxActive) {
    return { go: false, mode: "skip", reason: `aktif oturum limiti dolu (${active.length}/${maxActive})`, fingerprint: fp };
  }
  if ((i.spawns24h ?? 0) >= maxPerDay) {
    return { go: false, mode: "skip", reason: `24h bütçe dolu (${i.spawns24h}/${maxPerDay} spawn)`, fingerprint: fp };
  }
  if (i.candidateStable === false) {
    return { go: false, mode: "skip", reason: `churn-guard: hedef stabilite bekliyor (${i.req.target} birkaç bağımsız değerlendirmede kalıcı olmalı)`, fingerprint: fp };
  }
  if (i.lastStatus === "stale") {
    const lastMs = Math.max(0, ...i.sessions.map((s) => Date.parse(s.startedTs)).filter(Number.isFinite));
    if (lastMs && (i.nowMs - lastMs) / 3_600_000 < cooldownH) {
      const left = Math.ceil(cooldownH - (i.nowMs - lastMs) / 3_600_000);
      return { go: false, mode: "skip", reason: `failure-backoff (${cooldownH}h) — ~${left}h kaldı (son oturum stale)`, fingerprint: fp };
    }
  }
  if (!i.goEnabled) {
    return { go: false, mode: "dry", reason: "dry-run — aktivasyon: touch orchestration/.claude-dispatch-enabled + --go", fingerprint: fp };
  }
  return { go: true, mode: "spawn", reason: `spawn: ${i.req.criticality}:${i.req.target}`, fingerprint: fp };
}

/**
 * vO44 churn-guard: a requirement is dispatch-worthy only if it SURVIVED several independent
 * pipeline re-evaluations (critic/dod re-rank COMPLETENESS findings every pass — a target that is
 * top for a single tick is noise; spawning on it burns a session + a budget slot). Lines are
 * candidate-log JSONL `{ts, fingerprint, target}` appended EVERY tick (separate from the deduped
 * audit log, which cannot accumulate sightings by design).
 */
export function isStableCandidate(
  lines: string[], fp: string, nowMs: number,
  o?: { minSightings?: number; minSpanMin?: number; windowMin?: number },
): boolean {
  const minSightings = o?.minSightings ?? 3;
  const minSpanMin = o?.minSpanMin ?? 10;
  const windowMin = o?.windowMin ?? 90;
  const ts: number[] = [];
  for (const line of lines) {
    try {
      const c = JSON.parse(line);
      if (c?.fingerprint !== fp) continue;
      const t = Date.parse(c.ts);
      if (Number.isFinite(t) && (nowMs - t) / 60_000 <= windowMin) ts.push(t);
    } catch { /* skip malformed */ }
  }
  if (ts.length < minSightings) return false;
  return (Math.max(...ts) - Math.min(...ts)) / 60_000 >= minSpanMin;
}

/**
 * vO42: next-up queue — first ranked requirement whose target is not already an active/blocked
 * session target. Prefetched IN PARALLEL while the current task runs (zero-gap chaining).
 */
export function nextPending(reqs: Requirement[], sessions: DispatchSession[]): Requirement | null {
  const busy = new Set(sessions.filter((s) => s.status === "active" || s.status === "blocked").map(sessionTarget));
  return reqs.find((r) => !busy.has(r.target)) ?? null;
}

/** Conductor task prompt (autonomous, vO42 zero-question). Anthropic lead-agent pattern: objective /
 *  output format / boundaries / success criterion explicit. Build EN (fleet doctrine). */
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
    `orchestration pipeline (claude-dispatch vO41). Repo: ${repo}. Task fingerprint: ${fp}.`,
    ``,
    `OBJECTIVE — resolve the single most critical requirement the autonomous pipeline detected:`,
    `- criticality: ${req.criticality} (source: ${req.source}, score ${req.score})`,
    `- target: ${req.target}`,
    `- detail: ${req.detail}`,
    `- action: ${req.action}`,
    ``,
    `BOUNDARIES: work ONLY on this requirement's lane/scope. Do not refactor unrelated code, do not`,
    `touch other lanes' WIP, no git push. Your working set is the repo above.`,
    ``,
    `DOCTRINE (non-negotiable):`,
    `1. Invoke the \`fleet-orchestrator\` skill FIRST. You CONDUCT — you do not write feature code yourself.`,
    `2. AUTONOMOUS MODE (zero-question, operator's standing order): plan internally FIRST (research →`,
    `   plan → execute; read orchestration/REQUIREMENTS.md + CONDUCTOR.md + QUALITY.md for context).`,
    `   NEVER ask the operator anything — no confirmations, no yes/no. The quality gate replaces approval.`,
    `3. Distribute subtasks to the local model fleet: \`/council --debate\` for analysis decisions,`,
    `   \`/fleet --go\` for living agent-tabs, \`/think\` for recurring problems. ≤2 tasks/model, single-GPU FIFO.`,
    `4. ${runtime}.`,
    `5. Evidence only — no guessing. Every "works" claim = command output shown.`,
    `6. No half-work. Done means gated: tsc --noEmit 0 → vitest green (fresh run) → conventional commit.`,
    `7. PROPOSE-not-mutate: fleet worker output is gated by YOU before apply.`,
    ``,
    `OUTPUT FORMAT: end your work with a short evidence report — commands run, outputs, commit hash.`,
    ``,
    `SUCCESS CRITERION: after your commit, a fresh pipeline run (tsx orchestration/bin/autopilot.ts) no`,
    `longer lists target "${req.target}" in REQUIREMENTS.json — the pipeline auto-detects completion and`,
    `chains to the next requirement even if you forget the protocol below.`,
    ``,
    `COMPLETION PROTOCOL (fast path) — when verified resolved:`,
    `1. Append exactly one line to orchestration/seyir/claude-dispatch-state.jsonl:`,
    `{"fingerprint":"${fp}","task":"${req.criticality}:${req.target}","target":"${req.target}","app":"-","startedTs":"<now ISO>","status":"done"}`,
    `2. Then run \`npx tsx orchestration/bin/autopilot.ts --quiet\` as your LAST action — this refreshes`,
    `REQUIREMENTS at the completion moment so the pipeline chains to the next task within seconds.`,
  ].join("\n");
}

/** Human-readable decision report (CLAUDE_DISPATCH.md body). Pure. */
export function renderDispatchMd(i: {
  ts: string; plan: DispatchPlan; req: Requirement | null; sessions: DispatchSession[];
  killSwitch: boolean; goEnabled: boolean; app: SpawnApp; reqStale?: boolean;
  spawns24h?: number; maxPerDay?: number; nextUp?: Requirement | null;
  stability?: { sightings: number; spanMin: number; stable: boolean };
}): string {
  const icon = i.plan.mode === "spawn" ? "▶" : i.plan.mode === "dry" ? "[dry]" : i.plan.mode === "blocked" ? "🛑" : "⏭";
  const blocked = i.sessions.filter((s) => s.status === "blocked");
  const L = [
    `# CLAUDE_DISPATCH.md — otonom Claude Code conductor zinciri (vO41)`,
    ``,
    `> Auto: \`tsx orchestration/bin/claude-dispatch.ts [--go] [--app iterm2]\` · dry-run DEFAULT ·`,
    `> aktivasyon: \`touch orchestration/.claude-dispatch-enabled\` (tek sefer) · kill-switch: \`.claude-dispatch-off\` ·`,
    `> zincir: done → anında sıradaki; stale → 4h backoff; 2× stale → blocked (insan)`,
    ``,
    `## ${icon} ${i.plan.mode.toUpperCase()} — ${i.plan.reason}`,
    ``,
    `- ts: ${i.ts} · app: ${i.app} · go-enabled: ${i.goEnabled ? "✅" : "❌"} · kill-switch: ${i.killSwitch ? "🛑 ON" : "off"}${i.reqStale ? " · ⚠️ REQUIREMENTS bayat (spawn engellendi)" : ""}`,
    `- 24h bütçe: ${i.spawns24h ?? 0}/${i.maxPerDay ?? 6} spawn`,
    i.req
      ? `- top requirement: **${i.req.criticality}:${i.req.target}** — ${i.req.detail.slice(0, 100)} (fingerprint ${i.plan.fingerprint ?? "-"})`
      : `- top requirement: yok`,
  ];
  if (i.nextUp) L.push(`- ⏭ sıradaki (prefetched, paralel ön-hesap): **${i.nextUp.criticality}:${i.nextUp.target}**`);
  if (i.stability) L.push(`- 🎯 hedef stabilite (churn-guard): ${i.stability.sightings} gözlem / ${i.stability.spanMin} dk → ${i.stability.stable ? "✅ stabil" : "⏳ bekliyor"}`);
  if (blocked.length) L.push(`- 🛑 blocked (insan gerekli): ${blocked.map((b) => `${sessionTarget(b)} (${b.fingerprint})`).join(", ")}`);
  L.push(``, `## Oturumlar`);
  if (!i.sessions.length) L.push(`- (henüz oturum yok)`);
  else {
    L.push(`| fingerprint | task | app | started | status |`, `|---|---|---|---|---|`);
    for (const s of i.sessions) L.push(`| ${s.fingerprint} | ${s.task} | ${s.app} | ${s.startedTs} | ${s.status} |`);
  }
  return L.join("\n");
}
