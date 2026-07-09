import { describe, it, expect } from 'vitest';
import {
  parseEnvExample,
  scanEnvUsage,
  reconcile,
  undocumented,
  SAFE_RUNTIME_ENV,
} from '../env-contract';

describe('parseEnvExample', () => {
  it('extracts KEY= lines, ignoring comments and blanks', () => {
    const keys = parseEnvExample('# comment\nPORT=3000\n\nGEMINI_API_KEY=\n#DISABLED=1\nlowercase=x');
    expect([...keys].sort()).toEqual(['GEMINI_API_KEY', 'PORT']);
  });
});

describe('scanEnvUsage', () => {
  it('finds dot and bracket process.env reads with file provenance', () => {
    const usage = scanEnvUsage([
      { path: 'a.ts', text: 'const p = process.env.PORT; process.env["API_KEY"];' },
      { path: 'b.ts', text: 'process.env.PORT ?? 3000' },
    ]);
    expect([...usage.get('PORT')!].sort()).toEqual(['a.ts', 'b.ts']);
    expect(usage.has('API_KEY')).toBe(true);
  });
  it('ignores non-uppercase / dynamic access', () => {
    const usage = scanEnvUsage([{ path: 'a.ts', text: 'process.env[dynamic]; process.env.lower' }]);
    expect(usage.size).toBe(0);
  });
});

describe('reconcile + undocumented', () => {
  const documented = new Set(['PORT']);
  const usage = scanEnvUsage([
    { path: 'a.ts', text: 'process.env.PORT; process.env.NODE_ENV; process.env.SECRET_TOKEN' },
  ]);
  const rows = reconcile(documented, usage);

  it('classifies documented / runtime / UNDOCUMENTED', () => {
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(byKey.PORT).toBe('documented');
    expect(byKey.NODE_ENV).toBe('runtime'); // in SAFE_RUNTIME_ENV
    expect(byKey.SECRET_TOKEN).toBe('UNDOCUMENTED');
    expect(SAFE_RUNTIME_ENV.has('NODE_ENV')).toBe(true);
  });
  it('undocumented() returns only the MISS rows', () => {
    expect(undocumented(rows).map((r) => r.key)).toEqual(['SECRET_TOKEN']);
  });
});
