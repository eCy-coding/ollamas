import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ErrorBoundary} from 'react-error-boundary';
import {I18nProvider} from '@lingui/react';
import App from './App.tsx';
import './index.css';
import {ErrorFallback} from './components/ErrorFallback';
import {ThemeProvider} from './lib/theme';
import {i18n} from './lib/i18n';
import {logClientEvent} from './lib/apiClient';
import {reportWebVitals} from './lib/vitals';

// Firebase auth (Google Drive sign-in) only authorizes `localhost`, not `127.0.0.1`
// — signInWithPopup validates the page origin and throws auth/unauthorized-domain on
// the raw IP. Force the already-authorized host before anything (incl. Firebase) mounts.
if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
  const {port, pathname, search, hash} = window.location;
  window.location.replace(`http://localhost:${port || '3000'}${pathname}${search}${hash}`);
  throw new Error('redirecting 127.0.0.1 → localhost for Firebase auth'); // halt module eval; the replace navigates away
}

// vF8 — every render crash routes to the seyir defteri (adopted: react-error-boundary, MIT).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) =>
        logClientEvent('react_error', {
          message: error instanceof Error ? error.message : String(error),
          stack: info.componentStack ?? undefined,
        })
      }
    >
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// vF8 — catch what React can't: uncaught errors + unhandled promise rejections.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) =>
    logClientEvent('window_error', {message: e.message, source: e.filename, line: e.lineno}),
  );
  window.addEventListener('unhandledrejection', (e) => {
    const reason = String((e as PromiseRejectionEvent).reason);
    // Ignore the Vite dev-client HMR WebSocket noise (HMR is disabled in the served
    // build, so @vite/client's ws attempt always rejects) — a dev-tool artifact, not an
    // app error; it must not be counted as a crash that flips RUM health to "critical".
    if (/WebSocket closed without opened|@vite\/client|\[vite\]/i.test(reason)) return;
    logClientEvent('unhandled_rejection', {reason});
  });
}

// vF3 — ship field Core Web Vitals to the seyir defteri after paint.
void reportWebVitals();
