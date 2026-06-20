// vF12 — pure usage/quota logic over the tenant self-service endpoints. DOM-free
// so it is unit-testable. A quota is a quantity in a known range → the UI renders
// it as a WAI-ARIA meter, and these helpers produce the ratio/status it needs.

export interface UsageSummary {
  tenantId: string;
  plan: string;
  quota: number; // monthly_quota; <= 0 means unlimited / unknown
  used: number;
  period: string; // 'YYYY-MM'
}

export interface UsageSeriesPoint {
  day: string;
  calls: number;
  tokens: number;
}

export type UsageStatus = 'ok' | 'warn' | 'over';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// quota <= 0 (unlimited/unknown) → 0 so the meter reads empty rather than NaN/∞.
export function usageRatio(used: number, quota: number): number {
  if (!Number.isFinite(quota) || quota <= 0) return 0;
  return clamp01(used / quota);
}

export function usageStatus(ratio: number): UsageStatus {
  if (ratio >= 1) return 'over';
  if (ratio >= 0.75) return 'warn';
  return 'ok';
}

export function usagePercent(ratio: number): number {
  return Math.round(clamp01(ratio) * 100);
}

// Defensive: non-array → []. Feeds the vF10 Sparkline (daily call counts).
export function seriesToCalls(series: unknown): number[] {
  if (!Array.isArray(series)) return [];
  return series.map((p) => {
    const calls = (p as UsageSeriesPoint)?.calls;
    return typeof calls === 'number' && Number.isFinite(calls) ? calls : 0;
  });
}
