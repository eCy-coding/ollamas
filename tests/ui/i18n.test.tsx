import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderUI } from './helpers';
import { LanguageToggle } from '../../src/components/LanguageToggle';
import { i18n, activateLocale } from '../../src/lib/i18n';

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
