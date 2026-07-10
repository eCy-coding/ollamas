import { describe, it, expect, afterEach } from 'vitest';
import { activateLocale, localeDir, formatNumber, formatDate } from '../../src/lib/i18n';

// M-048 — locale-aware Intl formatting + text direction binding.
describe('i18n Intl format + direction (M-048)', () => {
  afterEach(() => activateLocale('en'));

  it('binds <html dir> to the active locale direction (ltr today)', () => {
    activateLocale('en');
    expect(localeDir('en')).toBe('ltr');
    expect(document.documentElement.dir).toBe('ltr');
    activateLocale('tr');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('formats numbers with the active locale grouping/decimal separators', () => {
    activateLocale('en');
    expect(formatNumber(1234567.89)).toBe(new Intl.NumberFormat('en').format(1234567.89));
    activateLocale('tr');
    expect(formatNumber(1234567.89)).toBe(new Intl.NumberFormat('tr').format(1234567.89));
    // EN uses ',' grouping + '.' decimal; TR uses '.' grouping + ',' decimal → must differ.
    activateLocale('en');
    const en = formatNumber(1234567.89);
    activateLocale('tr');
    const tr = formatNumber(1234567.89);
    expect(en).not.toBe(tr);
  });

  it('formats dates with the active locale', () => {
    const d = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    activateLocale('en');
    expect(formatDate(d, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d)
    );
    activateLocale('tr');
    expect(formatDate(d, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('tr', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d)
    );
  });
});
