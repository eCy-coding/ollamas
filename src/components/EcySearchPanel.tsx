import { useEffect, useRef, useState } from "react";
import { Search, Loader2, AlertTriangle, Square } from "lucide-react";
import { api } from "../lib/apiClient";

interface EcyStatus { running: boolean; ready: boolean; port: number; pid: number | null; restarts: number; lastError: string | null }

/**
 * "Search" tab — runs the external `ecysearch` GitHub searcher as a supervised sub-service under
 * ollamas and embeds its own UI (it serves SPA + /api on its own origin) via an iframe. On mount
 * it asks ollamas to launch ecysearch, polls /api/ecysearch/status until ready, then renders it.
 */
export default function EcySearchPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [status, setStatus] = useState<EcyStatus | null>(null);
  const [phase, setPhase] = useState<"starting" | "ready" | "error">("starting");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.post("/api/ecysearch/start");
      } catch (e) {
        if (!cancelled) { setPhase("error"); onNotify?.(`ecysearch start failed: ${String((e as Error).message)}`, "error"); }
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.get<EcyStatus>("/api/ecysearch/status");
          if (cancelled) return;
          setStatus(s);
          if (s.ready) {
            setPhase("ready");
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          } else if (!s.running && s.lastError) {
            setPhase("error");
          }
        } catch { /* transient — keep polling */ }
      }, 1000);
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [onNotify]);

  const stop = async () => {
    try { await api.post("/api/ecysearch/stop"); onNotify?.("ecysearch stopped", "info"); setPhase("starting"); setStatus(null); }
    catch (e) { onNotify?.(`stop failed: ${String((e as Error).message)}`, "error"); }
  };

  const port = status?.port ?? 3100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Search className="w-4 h-4 text-cyan-300" />
          <span>ecysearch — GitHub keyword searcher (supervised sub-service, :{port})</span>
        </div>
        {phase === "ready" && (
          <button onClick={stop} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
            <Square className="w-3 h-3" /> Stop
          </button>
        )}
      </div>

      {phase === "starting" && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Starting ecysearch under ollamas…
          {status?.restarts ? <span className="text-amber-400">(restart #{status.restarts})</span> : null}
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-start gap-2 text-sm text-rose-300 bg-rose-950/30 border border-rose-800 rounded p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>
            <div>Could not launch ecysearch.</div>
            {status?.lastError && <div className="text-rose-400 text-xs mt-1 font-mono">{status.lastError}</div>}
            <div className="text-slate-400 text-xs mt-1">Check the checkout at ECYSEARCH_DIR (default ~/Desktop/ecysearch) and that its deps are installed.</div>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <iframe
          src={`http://127.0.0.1:${port}`}
          title="ecysearch"
          className="w-full h-[80vh] rounded border border-slate-700 bg-white"
        />
      )}
    </div>
  );
}
