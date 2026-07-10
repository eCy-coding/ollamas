import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// vF9 runtime i18n. jsdom gives us localStorage + navigator + document, so we exercise the
// real branches: stored-locale precedence, navigator fallback, and the activate side effects
// (persist + <html lang> + lingui active locale). Importing the module activates a locale at
// load; each test then drives initialLocale/activateLocale directly (both read state fresh).
import { LOCALES, initialLocale, activateLocale, i18n } from '../../src/lib/i18n';

describe('runtime i18n (src/lib/i18n)', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });
  afterEach(() => { vi.restoreAllMocks(); });

  it('exposes exactly the supported locales', () => {
    expect(LOCALES).toEqual(['en', 'tr']);
  });

  it('initialLocale prefers a valid stored choice over the browser language', () => {
    localStorage.setItem('ollamas.locale', 'tr');
    expect(initialLocale()).toBe('tr');
    localStorage.setItem('ollamas.locale', 'en');
    expect(initialLocale()).toBe('en');
  });

  it('initialLocale ignores a garbage stored value and falls back to navigator', () => {
    localStorage.setItem('ollamas.locale', 'de'); // unsupported → must not be trusted
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('tr-TR');
    expect(initialLocale()).toBe('tr');
  });

  it('initialLocale falls back to en for a non-tr browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(initialLocale()).toBe('en');
  });

  it('activateLocale persists the choice, syncs <html lang>, and switches lingui', () => {
    activateLocale('tr');
    expect(localStorage.getItem('ollamas.locale')).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
    expect(i18n.locale).toBe('tr');

    activateLocale('en');
    expect(localStorage.getItem('ollamas.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.locale).toBe('en');
  });
});
