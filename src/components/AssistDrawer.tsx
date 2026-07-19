/**
 * src/components/AssistDrawer.tsx — "Ask eCy" specialist drawer (v12).
 *
 * Drop into any of the 5 eCym-controlled panels. Streams the panel's specialist
 * answer from POST /api/ecym/panel/:id (SSE), stripping <think> traces via the
 * shared certainty helper. The panel supplies a `context()` builder that returns a
 * COMPACT, redacted metadata string — for the keys panel it MUST be masked-only.
 *
 * v19: stream state (text/streaming/error) moved OUT of this component into
 * src/lib/streamStore.ts, keyed by `assist:<panelId>` — the panels that host this
 * drawer (search/github-actions/integrations/threatintel/keys) are unmounted on
 * tab switch, which used to orphan the in-flight stream and blank the drawer.
 */
import { useState } from "react";
import { Brain, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { assistStreamStore, startAssistStream, useAssistStream } from "../lib/streamStore";

export function AssistDrawer({
  panelId,
  context,
  label = "eCy'ye Sor",
  disabled,
}: {
  panelId: string;
  context: () => string;
  label?: string;
  disabled?: boolean;
}) {
  const key = `assist:${panelId}`;
  const { text, streaming, error: err } = useAssistStream(key);
  // Lazy-init from the store: if a previous run left an accumulated/finished
  // answer (or one is still streaming), returning to this panel should show it
  // immediately instead of a blank box waiting for another click.
  const [open, setOpen] = useState(() => {
    const snap = assistStreamStore.getSnapshot(key);
    return snap.streaming || !!snap.text || !!snap.error;
  });

  const run = () => {
    setOpen(true);
    startAssistStream({ key, endpoint: `/api/ecym/panel/${panelId}`, context: context() });
  };

  return (
    <div className="mt-2">
      <button
        onClick={run}
        disabled={streaming || disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-xs font-medium transition-colors disabled:opacity-40"
        title="eCym uzman alt-modelinden analiz iste"
      >
        {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
        {label}
      </button>
      {open && (
        <div className="mt-2 p-3 bg-immersive-panel border border-immersive-border rounded text-sm text-immersive-text-dim">
          <div className="flex items-center gap-1.5 mb-1.5 text-xs text-indigo-300">
            <Sparkles className="w-3.5 h-3.5" /> eCy uzmanı{streaming ? " · yazıyor…" : ""}
          </div>
          {err ? (
            <div className="flex gap-2 text-status-err text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
            </div>
          ) : text ? (
            <div className="whitespace-pre-wrap break-words leading-relaxed">{text}</div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-immersive-text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> model kuyrukta (tek-GPU sıralı)…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
