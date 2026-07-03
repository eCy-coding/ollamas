import React from "react";
import { Trophy } from "lucide-react";
import { useTelemetry } from "./useTelemetry";

// Per-provider comparison over the rolling window — pick the best route at a glance.
export function ProviderLeaderboard(): React.ReactElement {
  const { rollup } = useTelemetry();
  const rows = rollup.byProvider;
  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg mt-6">
      <div className="flex items-center gap-2.5 mb-4">
        <Trophy className="w-4 h-4 text-status-accent" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Provider Leaderboard — Last 60s</h2>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-immersive-text-dim font-mono py-4 text-center">No provider activity in the window yet.</div>
      ) : (
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-immersive-text-dim text-left border-b border-immersive-border">
              <th className="py-1.5 pr-3">Provider</th><th className="pr-3 text-right">Calls</th><th className="pr-3 text-right">tok/s</th>
              <th className="pr-3 text-right">Cost/1k</th><th className="pr-3 text-right">p95</th><th className="pr-3 text-right">avg TTFT</th><th className="pr-1 text-right">Success</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.provider} className="border-b border-immersive-border/40 text-immersive-text-muted">
                <td className="py-1 pr-3 text-immersive-text-bright">{p.provider}</td>
                <td className="pr-3 text-right">{p.calls}</td>
                <td className="pr-3 text-right">{Math.round(p.tokPerSec)}</td>
                <td className="pr-3 text-right">{p.costPer1k > 0 ? `$${p.costPer1k.toFixed(4)}` : "—"}</td>
                <td className="pr-3 text-right">{Math.round(p.p95Ms)}ms</td>
                <td className="pr-3 text-right">{p.avgTtftMs ? `${Math.round(p.avgTtftMs)}ms` : "—"}</td>
                <td className={`pr-1 text-right ${p.successPct >= 90 ? "text-status-ok" : p.successPct >= 50 ? "text-status-warn" : "text-status-err"}`}>{p.successPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
