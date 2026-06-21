import { Sun, Moon } from 'lucide-react';
import { useLingui } from '@lingui/react';
import { useTheme } from '../lib/theme';

// vF9 — accessible light/dark switch. aria-pressed = "is light active";
// label is translated (runtime i18n).
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { _ } = useLingui();
  const isDark = theme === 'dark';
  const text = isDark ? _('app.theme.toLight') : _('app.theme.toDark');
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={text}
      aria-pressed={!isDark}
      title={text}
      className="text-immersive-text-muted hover:text-immersive-text-bright border border-immersive-border rounded p-1.5 transition-colors"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
