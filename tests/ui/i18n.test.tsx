import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderUI } from './helpers';
import { LanguageToggle } from '../../src/components/LanguageToggle';
import { i18n, activateLocale } from '../../src/lib/i18n';
import { messages as enMessages } from '../../src/locales/en';
import { messages as trMessages } from '../../src/locales/tr';

// M-019 — key-parity guard: EN and TR catalogs must expose the exact same key
// set, or a locale switch silently falls back to the id for the missing keys.
describe('i18n key parity (M-019)', () => {
  it('EN and TR catalogs have an identical key set (diff = 0)', () => {
    const enKeys = new Set(Object.keys(enMessages));
    const trKeys = new Set(Object.keys(trMessages));
    const missingInTr = [...enKeys].filter((k) => !trKeys.has(k));
    const missingInEn = [...trKeys].filter((k) => !enKeys.has(k));
    expect(missingInTr).toEqual([]);
    expect(missingInEn).toEqual([]);
    expect(trKeys.size).toBe(enKeys.size);
  });
});

// vF9 — runtime catalog swap (TR/EN) + persisted LanguageToggle.
describe('i18n (vF9)', () => {
  beforeEach(() => {
    localStorage.clear();
    activateLocale('en');
  });
  afterEach(() => activateLocale('en'));

  it('returns the translation for the active locale', () => {
    activateLocale('en');
    expect(i18n._('app.tab.telemetry')).toBe('Cockpit Dashboard');
    activateLocale('tr');
    expect(i18n._('app.tab.telemetry')).toBe('Kokpit Paneli');
  });

  it('LanguageToggle switches locale, persists it, and updates <html lang>', async () => {
    activateLocale('en');
    renderUI(<LanguageToggle />);

    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('en');

    await userEvent.click(btn);

    expect(i18n.locale).toBe('tr');
    expect(localStorage.getItem('ollamas.locale')).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
    expect(btn).toHaveTextContent('tr');
  });
});
