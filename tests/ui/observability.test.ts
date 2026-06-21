import { describe, it, expect } from 'vitest';
import {
  percentile,
  ratingFor,
  vitalsSummary,
  categorizeError,
  errorCounts,
  totalErrors,
  errorBuckets,
  healthVerdict,
  frontendEvents,
  type LogEntry,
} from '../../src/lib/observability';

const vital = (metric: string, value: number): LogEntry => ({
  source: 'frontend',
  kind: 'note',
  note: `web-vital ${metric}`,
  metric,
  value,
  rating: 'good',
});
const ev = (note: string, ts?: string): LogEntry => ({ source: 'frontend', kind: 'note', note, ts });

describe('observability — pure logic (vF10)', () => {
  it('percentile uses nearest-rank', () => {
    expect(percentile([1, 2, 3, 4], 75)).toBe(3); // ceil(0.75*4)=3 → 3rd smallest
    expect(percentile([], 75)).toBe(0);
    expect(percentile([42], 75)).toBe(42);
  });

  it('ratingFor applies official web-vitals thresholds', () => {
    expect(ratingFor('LCP', 2000)).toBe('good');
    expect(ratingFor('LCP', 3000)).toBe('needs-improvement');
    expect(ratingFor('LCP', 5000)).toBe('poor');
    expect(ratingFor('CLS', 0.05)).toBe('good');
    expect(ratingFor('CLS', 0.3)).toBe('poor');
  });

  it('vitalsSummary computes count/latest/p75/rating per metric', () => {
    const summary = vitalsSummary([vital('LCP', 1000), vital('LCP', 2000), vital('LCP', 3000)]);
    const lcp = summary.find((s) => s.metric === 'LCP')!;
    expect(lcp.count).toBe(3);
    expect(lcp.latest).toBe(3000);
    expect(lcp.p75).toBe(3000); // nearest-rank of 3 samples at p75
    expect(lcp.rating).toBe('needs-improvement');
    const inp = summary.find((s) => s.metric === 'INP')!;
    expect(inp.count).toBe(0);
    expect(inp.p75).toBeNull();
  });

  it('categorizeError maps notes; transient reconnect is not an error', () => {
    expect(categorizeError('react_error')).toBe('react');
    expect(categorizeError('window_error')).toBe('window');
    expect(categorizeError('unhandled_rejection')).toBe('unhandled');
    expect(categorizeError('api_error 500 GET /x')).toBe('api');
    expect(categorizeError('api_stream_reconnect 503 /x')).toBeNull();
    expect(categorizeError('web-vital LCP')).toBeNull();
  });

  it('errorCounts ignores non-frontend + transient events', () => {
    const counts = errorCounts([
      ev('react_error'),
      ev('api_error 500 GET /x'),
      ev('api_stream_reconnect 503 /x'),
      { source: 'backend', note: 'react_error' }, // wrong source → ignored
    ]);
    expect(counts).toEqual({ react: 1, window: 0, unhandled: 0, api: 1 });
    expect(totalErrors(counts)).toBe(2);
  });

  it('errorBuckets places events into time buckets oldest→newest', () => {
    const now = 100_000;
    const bucketMs = 1_000;
    const n = 10; // window = [90_000, 100_000]
    const buckets = errorBuckets(
      [
        ev('react_error', new Date(90_500).toISOString()), // bucket 0
        ev('api_error 500 GET /x', new Date(99_500).toISOString()), // bucket 9
        ev('window_error', new Date(50_000).toISOString()), // out of window → dropped
        ev('react_error', undefined), // no ts → dropped
      ],
      now,
      bucketMs,
      n,
    );
    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toBe(1);
    expect(buckets[9]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('healthVerdict escalates healthy → degraded → critical', () => {
    const vitals = vitalsSummary([]);
    expect(healthVerdict(vitals, { react: 0, window: 0, unhandled: 0, api: 0 }).verdict).toBe('healthy');
    expect(healthVerdict(vitals, { react: 0, window: 0, unhandled: 0, api: 3 }).verdict).toBe('degraded');
    expect(healthVerdict(vitals, { react: 1, window: 0, unhandled: 0, api: 0 }).verdict).toBe('critical');
    // a single poor vital alone → degraded
    const poor = vitalsSummary([vital('LCP', 9000)]);
    expect(healthVerdict(poor, { react: 0, window: 0, unhandled: 0, api: 0 }).verdict).toBe('degraded');
  });

  it('frontendEvents filters by source', () => {
    const out = frontendEvents([ev('react_error'), { source: 'backend', note: 'x' }]);
    expect(out).toHaveLength(1);
  });

  it('frontendEvents unwraps the backend {entry} wrapper (real /api/logbook shape)', () => {
    // Backend stores POSTed client events as {ts, kind:'note', entry:{source,...}}.
    const wrapped: LogEntry[] = [
      { ts: '2026-06-20T00:00:00Z', kind: 'note', entry: { source: 'frontend', note: 'web-vital LCP', metric: 'LCP', value: 1899, rating: 'good' } },
      { ts: '2026-06-20T00:00:01Z', kind: 'agent_step', tool: 'list_tree' }, // backend row → not frontend
    ];
    const fe = frontendEvents(wrapped);
    expect(fe).toHaveLength(1);
    expect(fe[0].metric).toBe('LCP');
    expect(fe[0].value).toBe(1899);
    expect(vitalsSummary(wrapped).find((s) => s.metric === 'LCP')!.p75).toBe(1899);
  });
});
