import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ErrorBoundary} from 'react-error-boundary';
import App from './App.tsx';
import './index.css';
import {ErrorFallback} from './components/ErrorFallback';
import {logClientEvent} from './lib/apiClient';
import {reportWebVitals} from './lib/vitals';

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
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// vF8 — catch what React can't: uncaught errors + unhandled promise rejections.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) =>
    logClientEvent('window_error', {message: e.message, source: e.filename, line: e.lineno}),
  );
  window.addEventListener('unhandledrejection', (e) =>
    logClientEvent('unhandled_rejection', {reason: String((e as PromiseRejectionEvent).reason)}),
  );
}

// vF3 — ship field Core Web Vitals to the seyir defteri after paint.
void reportWebVitals();
