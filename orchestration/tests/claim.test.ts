import { describe, it, expect } from 'vitest';
import { fmtAge } from '../bin/claim';
describe('fmtAge', () => {
  it('minutes under an hour', () => { expect(fmtAge(0)).toBe('0dk'); expect(fmtAge(30*60000)).toBe('30dk'); expect(fmtAge(59*60000)).toBe('59dk'); });
  it('hours and minutes', () => { expect(fmtAge(60*60000)).toBe('1s0dk'); expect(fmtAge(90*60000)).toBe('1s30dk'); expect(fmtAge(125*60000)).toBe('2s5dk'); });
});