import { i18n } from '@lingui/core';
import { messages as en, dir as enDir } from '../locales/en';
import { messages as tr, dir as trDir } from '../locales/tr';

// vF9 — runtime i18n (adopted: lingui/js-lingui, MIT). No macro / no vite-plugin
// → zero build risk; catalogs are plain id→string maps loaded eagerly (small).
export type Locale = 'en' | 'tr';
export type Direction = 'ltr' | 'rtl';
export const LOCALES: Locale[] = ['en', 'tr'];
const STORAGE_KEY = 'ollamas.locale';

// M-048 — per-locale text direction. ltr today; adding an rtl catalog (e.g. 'ar')
// only needs its `dir: 'rtl'` export to flip <html dir> + mirror the layout.
const LOCALE_DIR: Record<Locale, Direction> = { en: enDir, tr: trDir };

/** Text direction for a locale ('ltr' | 'rtl'). Defaults to the active locale. */
export function localeDir(locale: Locale = i18n.locale as Locale): Direction {
  return LOCALE_DIR[locale] ?? 'ltr';
}

// M-048 — locale-aware Intl formatters. Cached per (locale, options) so repeated
// renders don't rebuild the (relatively expensive) Intl objects.
const numberFmtCache = new Map<string, Intl.NumberFormat>();
const dateFmtCache = new Map<string, Intl.DateTimeFormat>();

/** Format a number with the active locale's grouping/decimal conventions. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const locale = (i18n.locale as Locale) || 'en';
  const key = locale + '|' + JSON.stringify(options);
  let fmt = numberFmtCache.get(key);
  if (!fmt) { fmt = new Intl.NumberFormat(locale, options); numberFmtCache.set(key, fmt); }
  return fmt.format(value);
}

/** Format a date/time with the active locale. */
export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions = {}): string {
  const locale = (i18n.locale as Locale) || 'en';
  const key = locale + '|' + JSON.stringify(options);
  let fmt = dateFmtCache.get(key);
  if (!fmt) { fmt = new Intl.DateTimeFormat(locale, options); dateFmtCache.set(key, fmt); }
  return fmt.format(value);
}

i18n.load({ en, tr });

export function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'tr') return stored;
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

// Switch locale, persist the choice, and keep <html lang> in sync (a11y/SEO).
export function activateLocale(locale: Locale): void {
  i18n.activate(locale);
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale); // M-048 — RTL-ready direction bind
}

// Activate synchronously at import so the first render is already translated.
activateLocale(initialLocale());

export { i18n };
