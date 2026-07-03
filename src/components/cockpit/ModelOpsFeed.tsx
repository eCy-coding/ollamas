import React from "react";
import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { useTelemetry, type RequestEventVM } from "./useTelemetry";

// Live request tail — one row per model operation (newest first). Metadata only (redacted
// server-side); prompt/completion text never reaches here.
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });
const fmtMs = (ms?: number) => (typeof ms === "number" ? `${Math.round(ms)}ms` : "—");
const fmtCost = (usd: number) => (usd > 0 ? `$${usd.toFixed(4)}` : "—");

export function ModelOpsFeed(): React.ReactElement {
  const { events } = useTelemetry();
  const rows: RequestEventVM[] = [...events].reverse().slice(0, 200);
  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg mt-6">
      <div className="flex items-center gap-2.5 mb-4">
        <Activity className="w-4 h-4 text-status-accent" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Model Ops — Live Request Feed</h2>
        <span className="text-[10px] text-immersive-text-dim font-mono ml-auto">{rows.length} recent · metadata only</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-immersive-text-dim font-mono py-6 text-center">No model operations yet — drive a request to see it here live.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-immersive-text-dim text-left border-b border-immersive-border">
                <th className="py-1.5 pr-3">Time</th><th className="pr-3">Provider</th><th className="pr-3">Model</th>
                <th className="pr-3 text-right">TTFT</th><th className="pr-3 text-right">Total</th><th className="pr-3 text-right">In/Out</th>
                <th className="pr-3 text-right">tok/s</th><th className="pr-3 text-right">Cost</th><th className="pr-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.requestId + e.ts} className="border-b border-immersive-border/40 text-immersive-text-muted">
                  <td className="py-1 pr-3 text-immersive-text-dim">{fmtTime(e.ts)}</td>
                  <td className="pr-3 text-immersive-text-bright">{e.providerName}{e.fallbackFrom ? <span className="text-status-warn"> ←{e.fallbackFrom}</span> : null}</td>
                  <td className="pr-3">{e.responseModel || e.requestModel || "—"}</td>
                  <td className="pr-3 text-right">{fmtMs(e.ttftMs)}</td>
                  <td className="pr-3 text-right">{fmtMs(e.totalMs)}</td>
                  <td className="pr-3 text-right">{e.inputTokens}/{e.outputTokens}</td>
                  <td className="pr-3 text-right">{e.tokPerSec ? Math.round(e.tokPerSec) : "—"}</td>
                  <td className="pr-3 text-right">{fmtCost(e.costUsd)}</td>
                  <td className="pr-1">{e.status === "ok" ? (<span className="text-status-ok inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> ok</span>) : (<span className="text-status-err inline-flex items-center gap-1"><XCircle className="w-3 h-3" /> {e.errorType || "error"}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
