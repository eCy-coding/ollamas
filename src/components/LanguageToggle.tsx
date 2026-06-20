import { Languages } from 'lucide-react';
import { useLingui } from '@lingui/react';
import { activateLocale, type Locale } from '../lib/i18n';

// vF9 — TR/EN switch. useLingui re-renders on i18n.activate, so the shown code
// flips reactively; activateLocale persists + updates <html lang>.
export function LanguageToggle() {
  const { i18n, _ } = useLingui();
  const current = (i18n.locale as Locale) || 'en';
  const next: Locale = current === 'en' ? 'tr' : 'en';
  return (
    <button
      type="button"
      onClick={() => activateLocale(next)}
      aria-label={`${_('app.lang.label')}: ${current.toUpperCase()}`}
      title={_('app.lang.label')}
      className="flex items-center gap-1.5 text-immersive-text-muted hover:text-immersive-text-bright border border-immersive-border rounded px-2 py-1.5 text-xs font-mono uppercase transition-colors"
    >
      <Languages className="w-4 h-4" />
      {current}
    </button>
  );
}
