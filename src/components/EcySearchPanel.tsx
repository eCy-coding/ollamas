import { useEffect, useRef, useState } from "react";
import { Search, Loader2, AlertTriangle, Square, ScrollText } from "lucide-react";
import { api } from "../lib/apiClient";

type EcyState = "stopped" | "starting" | "ready" | "unhealthy" | "crashed";
interface EcyStatus {
  state: EcyState; running: boolean; ready: boolean; port: number; pid: number | null;
  startedAt: number | null; uptimeMs: number; lastReadyAt: number | null; lastExitCode: number | null;
  restarts: number; consecutiveFailures: number; circuitOpen: boolean; logFile: string;
}

/**
 * "Search" tab — runs the external `ecysearch` GitHub searcher as a supervised sub-service under
 * ollamas and embeds its own UI (it serves SPA + /api on its own origin) via an iframe. Shows the
 * supervisor's live state (state · uptime · restarts) and a tail of the persistent .log file.
 */
export default function EcySearchPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [status, setStatus] = useState<EcyStatus | null>(null);
  const [phase, setPhase] = useState<"starting" | "ready" | "error">("starting");
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
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
          if (s.ready) setPhase("ready");
          else if (s.state === "crashed") setPhase("error");
          else setPhase("starting");
        } catch { /* transient — keep polling */ }
      }, 1500);
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [onNotify]);

  // Poll the persisted .log tail while the panel is open with logs expanded.
  useEffect(() => {
    if (!showLogs) return;
    let cancelled = false;
    const tick = async () => {
      try { const r = await api.get<{ lines: string[] }>("/api/ecysearch/logs?limit=120"); if (!cancelled) setLogs(r.lines); } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [showLogs]);

  const stop = async () => {
    try { await api.post("/api/ecysearch/stop"); onNotify?.("ecysearch stopped", "info"); setPhase("starting"); setStatus(null); }
    catch (e) { onNotify?.(`stop failed: ${String((e as Error).message)}`, "error"); }
  };

  const port = status?.port ?? 3100;
  const upSec = status ? Math.floor(status.uptimeMs / 1000) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Search className="w-4 h-4 text-cyan-300" />
          <span>ecysearch — supervised sub-service, :{port}</span>
          {status && (
            <span className="text-xs font-mono text-slate-400 ml-1">
              <span className={status.state === "ready" ? "text-emerald-400" : status.state === "crashed" ? "text-rose-400" : status.state === "unhealthy" ? "text-amber-400" : "text-slate-400"}>
                {status.state}
              </span>
              {status.running && ` · up ${upSec}s`}
              {status.restarts > 0 && ` · restarts ${status.restarts}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLogs((v) => !v)} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
            <ScrollText className="w-3 h-3" /> {showLogs ? "Hide logs" : "Logs"}
          </button>
          {phase === "ready" && (
            <button onClick={stop} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
              <Square className="w-3 h-3" /> Stop
            </button>
          )}
        </div>
      </div>

      {showLogs && (
        <pre className="text-[11px] leading-tight font-mono bg-slate-950/70 border border-slate-700 rounded p-2 max-h-48 overflow-auto text-slate-400">
          {logs.length ? logs.join("\n") : "(no log lines yet)"}
        </pre>
      )}

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
            <div>{status?.circuitOpen ? "ecysearch is in a crash loop — the supervisor gave up." : "Could not launch ecysearch."}</div>
            <div className="text-slate-400 text-xs mt-1">
              {status?.lastExitCode != null && `last exit code ${status.lastExitCode}. `}
              Check the checkout at ECYSEARCH_DIR (default ~/Desktop/ecysearch) and its deps. Click Logs for details, then press the tab again to retry (manual start resets the circuit).
            </div>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <iframe
          src={`http://127.0.0.1:${port}`}
          title="ecysearch"
          className="w-full h-[78vh] rounded border border-slate-700 bg-white"
        />
      )}
    </div>
  );
}
