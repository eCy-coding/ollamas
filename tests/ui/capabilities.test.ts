import { describe, it, expect } from 'vitest';
import {
  hasCapability,
  isTabEnabled,
  capabilityFor,
  TAB_CAPABILITY,
  type Permissions,
} from '../../src/lib/capabilities';

const perms = (o: Partial<Permissions> = {}): Permissions => ({
  fileRead: false,
  fileWrite: false,
  commandExec: false,
  git: false,
  ...o,
});

describe('capabilities — pure logic (vF11)', () => {
  it('hasCapability is deny-by-default for unknown permissions', () => {
    expect(hasCapability(null, 'commandExec')).toBe(false);
    expect(hasCapability(undefined, 'commandExec')).toBe(false);
    expect(hasCapability(perms({ commandExec: true }), 'commandExec')).toBe(true);
    expect(hasCapability(perms({ commandExec: false }), 'commandExec')).toBe(false);
  });

  it('capabilityFor maps gated tabs and leaves the rest open', () => {
    expect(capabilityFor('terminal')).toBe('commandExec');
    expect(capabilityFor('automation')).toBe('commandExec');
    expect(capabilityFor('backup')).toBe('fileWrite');
    expect(capabilityFor('files')).toBe('fileRead');
    expect(capabilityFor('telemetry')).toBeNull();
    expect(capabilityFor('saas')).toBeNull();
    expect(capabilityFor('unknown-tab')).toBeNull();
  });

  it('isTabEnabled: null-capability tabs always enabled; gated tabs follow permission', () => {
    expect(isTabEnabled('telemetry', null)).toBe(true); // ungated even with no perms
    expect(isTabEnabled('terminal', null)).toBe(false); // deny-by-default
    expect(isTabEnabled('terminal', perms({ commandExec: true }))).toBe(true);
    expect(isTabEnabled('terminal', perms({ commandExec: false }))).toBe(false);
    expect(isTabEnabled('backup', perms({ fileWrite: true }))).toBe(true);
    expect(isTabEnabled('files', perms({ fileRead: false }))).toBe(false);
  });

  it('TAB_CAPABILITY covers all 13 tabs', () => {
    expect(Object.keys(TAB_CAPABILITY)).toHaveLength(13);
  });
});
