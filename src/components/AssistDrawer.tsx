/**
 * src/components/AssistDrawer.tsx — "Ask eCy" specialist drawer (v12).
 *
 * Drop into any of the 5 eCym-controlled panels. Streams the panel's specialist
 * answer from POST /api/ecym/panel/:id (SSE), stripping <think> traces via the
 * shared certainty helper. The panel supplies a `context()` builder that returns a
 * COMPACT, redacted metadata string — for the keys panel it MUST be masked-only.
 */
import { useState } from "react";
import { Brain, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { api } from "../lib/apiClient";
import { stripThink } from "../lib/certainty";

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
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setOpen(true);
    setStreaming(true);
    setText("");
    setErr("");
    let acc = "";
    let buf = "";
    try {
      // Honest hard ceiling: on a saturated single GPU the specialist may never get a
      // slot — fail with a clear message instead of hanging the drawer forever.
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("model 90sn'de yanıt vermedi (GPU meşgul) — sonra tekrar dene")), 90_000),
      );
      await Promise.race([timeout, api.streamPost(`/api/ecym/panel/${panelId}`, { context: context() }, {
        onChunk: (t: string) => {
          buf += t;
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const f = JSON.parse(line.slice(5).trim());
              if (f.chunk) { acc += f.chunk; setText(stripThink(acc).visible); }
              else if (f.error) setErr(String(f.error));
            } catch { /* partial frame */ }
          }
        },
      })]);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => void run()}
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
