import React from "react";
import { Gauge, AlertTriangle, Zap, DollarSign, Timer } from "lucide-react";
import { useTelemetry } from "./useTelemetry";

// Rolling-window stat tiles (60s window, server-computed) — the at-a-glance model-fleet health.
function Tile({ label, value, sub, tone = "accent", Icon }: { label: string; value: string; sub?: string; tone?: "accent" | "warn" | "ok"; Icon: React.ComponentType<{ className?: string }> }) {
  const toneCls = tone === "warn" ? "text-status-warn" : tone === "ok" ? "text-status-ok" : "text-status-accent";
  return (
    <div className="bg-immersive-inset border border-immersive-border rounded p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-immersive-text-dim"><Icon className={`w-3 h-3 ${toneCls}`} /> {label}</div>
      <div className={`text-lg font-mono font-bold ${toneCls}`}>{value}</div>
      {sub ? <div className="text-[9px] font-mono text-immersive-text-dim">{sub}</div> : null}
    </div>
  );
}
export function RollupTiles(): JSX.Element {
  const { rollup: r } = useTelemetry();
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg mt-6">
      <div className="flex items-center gap-2.5 mb-4">
        <Gauge className="w-4 h-4 text-status-accent" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Rollup — Last 60s</h2>
        <span className="text-[10px] text-immersive-text-dim font-mono ml-auto">{r.count} req</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="p95 latency" value={`${Math.round(r.p95TotalMs)}ms`} sub={`p50 ${Math.round(r.p50TotalMs)}ms`} Icon={Timer} />
        <Tile label="p95 TTFT" value={`${Math.round(r.p95TtftMs)}ms`} sub={`p50 ${Math.round(r.p50TtftMs)}ms`} Icon={Timer} />
        <Tile label="Error rate" value={pct(r.errorRate)} tone={r.errorRate > 0.1 ? "warn" : "ok"} Icon={AlertTriangle} />
        <Tile label="Throughput" value={`${Math.round(r.tokPerSec)} tok/s`} Icon={Zap} />
        <Tile label="Req/min" value={`${r.reqPerMin}`} Icon={Gauge} />
        <Tile label="Cost/hr" value={`$${r.costPerHr.toFixed(3)}`} Icon={DollarSign} />
      </div>
    </div>
  );
}
