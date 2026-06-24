import { describe, it, expect } from "vitest";
import { toDetectedNote } from "../bin/scan";

describe('toDetectedNote', () => {
  it('maps a Finding to a detected DiagnosticNote', () => {
    const finding = { targetPath: 'server/x.ts', severity: 'high', finding: 'missing guard', evidence: 'line 10' };
    const persona = { name: 'security', targetLane: 'backend', targets: [] };
    
    const n = toDetectedNote(finding as any, persona as any, 3, 'abc1234', '2026-06-24T00:00:00.000Z');
    
    expect(n.id).toBe('security-backend-3');
    expect(n.persona).toBe('security');
    expect(n.targetLane).toBe('backend');
    expect(n.targetPath).toBe('server/x.ts');
    expect(n.severity).toBe('high');
    expect(n.finding).toBe('missing guard');
    expect(n.evidence).toBe('line 10');
    expect(n.confidence).toBe('detected');
    expect(n.source).toBe('detected');
    expect(n.solution).toBeUndefined();
    expect(n.minRefs).toBe(2);
    expect(n.status).toBe('open');
    expect(n.targetHash).toBe('abc1234');
    expect(n.ts).toBe('2026-06-24T00:00:00.000Z');
  });
});