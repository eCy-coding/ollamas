import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// vF9 — theme state lives here so the whole tree flips via a single
// `[data-theme]` attribute on <html>; color values come from the vF5 token
// layer (tokens.css :root = dark, tokens-light.css [data-theme="light"]).
// Components stay theme-agnostic (no `dark:` prefixes).
export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'ollamas.theme';

// Initial read order: the no-flash inline script (index.html) already set
// data-theme pre-paint, so trust that first; then localStorage; then OS.
function initialTheme(): Theme {
  const fromDom = document.documentElement.dataset.theme;
  if (fromDom === 'dark' || fromDom === 'light') return fromDom;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
