import type { FallbackProps } from 'react-error-boundary';

// vF8 — last-resort fallback when a component subtree throws. Token-styled,
// a11y role=alert, offers a reset (re-mount the subtree) without a full reload.
export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div
      role="alert"
      className="m-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-6 font-mono text-sm text-rose-200"
    >
      <h2 className="mb-2 text-base font-bold text-rose-100">Something broke in the cockpit</h2>
      <p className="mb-4 text-rose-200/80">
        This panel hit an unexpected error and was isolated so the rest of the app keeps running.
      </p>
      <pre className="mb-4 max-h-40 overflow-auto rounded bg-black/40 p-3 text-xs text-rose-300/90">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <button
        type="button"
        onClick={resetErrorBoundary}
        className="rounded border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-xs font-bold text-rose-100 hover:bg-rose-500/25"
      >
        Try again
      </button>
    </div>
  );
}
