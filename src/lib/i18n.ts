import { i18n } from '@lingui/core';
import { messages as en } from '../locales/en';
import { messages as tr } from '../locales/tr';

// vF9 — runtime i18n (adopted: lingui/js-lingui, MIT). No macro / no vite-plugin
// → zero build risk; catalogs are plain id→string maps loaded eagerly (small).
export type Locale = 'en' | 'tr';
export const LOCALES: Locale[] = ['en', 'tr'];
const STORAGE_KEY = 'ollamas.locale';

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
}

// Activate synchronously at import so the first render is already translated.
activateLocale(initialLocale());

export { i18n };
