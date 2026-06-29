import type { CpuInfo } from "node:os";

const sumTimes = (t: CpuInfo["times"]): number => t.user + t.nice + t.sys + t.idle + t.irq;

// Per-core busy% over the interval between two os.cpus() snapshots. Pure: callers pass
// the snapshots. busy% = 100*(1 - idleDelta/totalDelta), rounded 1dp, clamped 0..100.
export function coreUtilization(prev: CpuInfo[], now: CpuInfo[]): number[] {
  if (!prev?.length || !now?.length) return [];
  const n = Math.min(prev.length, now.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const totalDelta = sumTimes(now[i].times) - sumTimes(prev[i].times);
    const idleDelta = now[i].times.idle - prev[i].times.idle;
    if (totalDelta <= 0) { out.push(0); continue; }
    const busy = 100 * (1 - idleDelta / totalDelta);
    out.push(Math.max(0, Math.min(100, Number(busy.toFixed(1)))));
  }
  return out;
}

const tsMs = (v: unknown): number | null => {
  if (v == null) return null;
  const t = new Date(v as any).getTime();
  return Number.isFinite(t) ? t : null;
};

// Real activity rollup from agent sessions + stage/agent events. Pure.
export function activitySummary(
  sessions: { updatedAt?: string | number }[] | null | undefined,
  events: { ts?: string | number }[] | null | undefined,
  nowMs: number,
): { sessionCount: number; recentRuns: number; lastActivityAgoSec: number | null } {
  const ss = Array.isArray(sessions) ? sessions : [];
  const ev = Array.isArray(events) ? events : [];
  const recentRuns = ev.filter((e) => { const t = tsMs(e?.ts); return t != null && nowMs - t <= 3_600_000; }).length;
  let maxTs: number | null = null;
  for (const s of ss) { const t = tsMs(s?.updatedAt); if (t != null && (maxTs == null || t > maxTs)) maxTs = t; }
  for (const e of ev) { const t = tsMs(e?.ts); if (t != null && (maxTs == null || t > maxTs)) maxTs = t; }
  const lastActivityAgoSec = maxTs == null ? null : Math.max(0, Math.floor((nowMs - maxTs) / 1000));
  return { sessionCount: ss.length, recentRuns, lastActivityAgoSec };
}
