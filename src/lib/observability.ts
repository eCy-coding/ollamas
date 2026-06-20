// vF10 — pure observability logic over /api/logbook entries. DOM-free so it is
// unit-testable in isolation; the panel/hook only render what these derive.
// p75 = the RUM-standard reporting percentile (nearest-rank); thresholds are the
// official web-vitals good/needs-improvement boundaries.

export type Rating = 'good' | 'needs-improvement' | 'poor';
export type VitalMetric = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';

export interface LogEntry {
  ts?: string;
  kind?: string;
  source?: string;
  note?: string;
  metric?: string;
  value?: number;
  rating?: string;
  message?: string;
  reason?: string;
  status?: number;
  [k: string]: unknown;
}

export interface LogbookResponse {
  count: number;
  total: number;
  entries: LogEntry[];
}

export const VITAL_METRICS: VitalMetric[] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];

// [good ≤, needs-improvement ≤]; above the second value = poor.
const THRESHOLDS: Record<VitalMetric, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function ratingFor(metric: VitalMetric, value: number): Rating {
  const [good, needs] = THRESHOLDS[metric];
  if (value <= good) return 'good';
  if (value <= needs) return 'needs-improvement';
  return 'poor';
}

export function frontendEvents(entries: LogEntry[]): LogEntry[] {
  return entries.filter((e) => e.source === 'frontend');
}

// Nearest-rank percentile (p in 0..100). Empty → 0.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length); // 1-based
  return sorted[Math.min(rank, sorted.length) - 1];
}

export interface VitalStat {
  metric: VitalMetric;
  count: number;
  latest: number | null;
  p75: number | null;
  rating: Rating | null;
}

export function vitalsSummary(entries: LogEntry[]): VitalStat[] {
  const fe = frontendEvents(entries);
  return VITAL_METRICS.map((metric) => {
    const values = fe
      .filter((e) => e.metric === metric && typeof e.value === 'number')
      .map((e) => e.value as number);
    if (values.length === 0) {
      return { metric, count: 0, latest: null, p75: null, rating: null };
    }
    const p75 = percentile(values, 75);
    return {
      metric,
      count: values.length,
      latest: values[values.length - 1], // server returns chronological slice(-limit)
      p75,
      rating: ratingFor(metric, p75),
    };
  });
}

export type ErrorCategory = 'react' | 'window' | 'unhandled' | 'api';

// `api_stream_reconnect*` is a transient retry signal, not a failure → excluded.
export function categorizeError(note: string | undefined): ErrorCategory | null {
  if (!note) return null;
  if (note === 'react_error') return 'react';
  if (note === 'window_error') return 'window';
  if (note === 'unhandled_rejection') return 'unhandled';
  if (
    note.startsWith('api_error') ||
    note.startsWith('api_network_error') ||
    note.startsWith('api_stream_error')
  ) {
    return 'api';
  }
  return null;
}

export type ErrorCounts = Record<ErrorCategory, number>;

export function errorCounts(entries: LogEntry[]): ErrorCounts {
  const acc: ErrorCounts = { react: 0, window: 0, unhandled: 0, api: 0 };
  for (const e of frontendEvents(entries)) {
    const cat = categorizeError(e.note);
    if (cat) acc[cat] += 1;
  }
  return acc;
}

export function totalErrors(counts: ErrorCounts): number {
  return counts.react + counts.window + counts.unhandled + counts.api;
}

// Count error events into `n` equal time-buckets spanning [now - n*bucketMs, now].
// Returns oldest→newest so the array feeds a left-to-right sparkline.
export function errorBuckets(
  entries: LogEntry[],
  now: number,
  bucketMs: number,
  n: number,
): number[] {
  const buckets = new Array<number>(n).fill(0);
  const start = now - n * bucketMs;
  for (const e of frontendEvents(entries)) {
    if (!categorizeError(e.note)) continue;
    const t = e.ts ? Date.parse(e.ts) : NaN;
    if (Number.isNaN(t) || t < start || t > now) continue;
    let idx = Math.floor((t - start) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    buckets[idx] += 1;
  }
  return buckets;
}

export type Verdict = 'healthy' | 'degraded' | 'critical';
export interface HealthResult {
  verdict: Verdict;
  reasonKey: string;
}

// Self-heal-lite signal: any crash or a flood of errors = critical (suggest
// reload); a few errors or one poor vital = degraded; otherwise healthy.
export function healthVerdict(vitals: VitalStat[], counts: ErrorCounts): HealthResult {
  const errs = totalErrors(counts);
  const crashes = counts.react + counts.window + counts.unhandled;
  const poorVitals = vitals.filter((v) => v.rating === 'poor').length;
  if (crashes >= 1 || errs >= 10) return { verdict: 'critical', reasonKey: 'app.obs.reason.critical' };
  if (errs >= 3 || poorVitals >= 1) return { verdict: 'degraded', reasonKey: 'app.obs.reason.degraded' };
  return { verdict: 'healthy', reasonKey: 'app.obs.reason.healthy' };
}
