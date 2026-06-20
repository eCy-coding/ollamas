import { describe, it, expect } from 'vitest';
import { usageRatio, usageStatus, usagePercent, seriesToCalls } from '../../src/lib/usage';

describe('usage — pure logic (vF12)', () => {
  it('usageRatio clamps, guards NaN, and treats quota<=0 as unlimited (0)', () => {
    expect(usageRatio(50, 100)).toBe(0.5);
    expect(usageRatio(150, 100)).toBe(1); // clamp to 1
    expect(usageRatio(5, 0)).toBe(0); // unlimited/unknown
    expect(usageRatio(5, -1)).toBe(0);
    expect(usageRatio(Number.NaN, 100)).toBe(0); // NaN guard
    expect(usageRatio(-5, 100)).toBe(0);
  });

  it('usageStatus crosses ok → warn → over', () => {
    expect(usageStatus(0)).toBe('ok');
    expect(usageStatus(0.74)).toBe('ok');
    expect(usageStatus(0.75)).toBe('warn');
    expect(usageStatus(0.99)).toBe('warn');
    expect(usageStatus(1)).toBe('over');
    expect(usageStatus(1.5)).toBe('over');
  });

  it('usagePercent rounds the clamped ratio', () => {
    expect(usagePercent(0.5)).toBe(50);
    expect(usagePercent(0.756)).toBe(76);
    expect(usagePercent(2)).toBe(100);
  });

  it('seriesToCalls extracts calls; non-array → []', () => {
    expect(seriesToCalls([{ day: '2026-06-01', calls: 5, tokens: 10 }, { day: '2026-06-02', calls: 9, tokens: 20 }])).toEqual([5, 9]);
    expect(seriesToCalls([{ day: 'x', tokens: 1 } as unknown])).toEqual([0]); // missing calls → 0
    expect(seriesToCalls(null)).toEqual([]);
    expect(seriesToCalls(undefined)).toEqual([]);
    expect(seriesToCalls('nope')).toEqual([]);
  });
});
