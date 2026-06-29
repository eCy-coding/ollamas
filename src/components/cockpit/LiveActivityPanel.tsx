import React from "react";
import { Activity, Cpu, Gauge } from "lucide-react";

export interface LiveActivityPanelProps {
  cores: number[];
  activity: { sessionCount: number; recentRuns: number; lastActivityAgoSec: number | null };
  backendLatencyMs: number | null;
}

function coreColor(p: number): string {
  if (p <= 60) return "bg-status-ok";
  if (p <= 85) return "bg-status-warn";
  return "bg-status-err";
}

function latencyColor(ms: number | null): string {
  if (ms === null) return "text-immersive-text-dim";
  if (ms < 300) return "text-status-ok";
  if (ms < 1000) return "text-status-warn";
  return "text-status-err";
}

function humanizeAgo(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function LiveActivityPanel({ cores, activity, backendLatencyMs }: LiveActivityPanelProps): React.ReactElement {
  return (
    <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded shadow-lg min-h-[7rem]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-status-accent" /> Real-Time Activity
        </span>
      </div>

      <div className="mb-3">
        <span className="text-[9px] text-immersive-text-dim uppercase flex items-center gap-1 mb-1">
          <Cpu className="w-3 h-3" /> CPU Cores ({cores.length})
        </span>
        {cores.length === 0 ? (
          <span className="text-[10px] italic text-immersive-text-dim">sampling…</span>
        ) : (
          <div className="flex gap-1 items-end">
            {cores.map((p, i) => (
              <div
                key={i}
                className="flex-1 h-8 bg-immersive-inset rounded-sm relative"
                role="img"
                aria-label={`core ${i} ${p}%`}
              >
                <div
                  className={`absolute bottom-0 w-full rounded-sm ${coreColor(p)}`}
                  style={{ height: `${p}%` }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-immersive-inset p-2 rounded border border-immersive-border text-center">
          <div className="text-[9px] text-immersive-text-dim uppercase">Sessions</div>
          <div className="text-sm font-bold text-immersive-text-bright font-mono">{activity.sessionCount}</div>
        </div>
        <div className="bg-immersive-inset p-2 rounded border border-immersive-border text-center">
          <div className="text-[9px] text-immersive-text-dim uppercase">Runs/1h</div>
          <div className="text-sm font-bold text-immersive-text-bright font-mono">{activity.recentRuns}</div>
        </div>
        <div className="bg-immersive-inset p-2 rounded border border-immersive-border text-center">
          <div className="text-[9px] text-immersive-text-dim uppercase">Last</div>
          <div className="text-sm font-bold text-immersive-text-bright font-mono">
            {activity.lastActivityAgoSec === null ? "—" : humanizeAgo(activity.lastActivityAgoSec)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-immersive-text-dim uppercase flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5" /> BACKEND
        </span>
        <span className={latencyColor(backendLatencyMs)}>
          {backendLatencyMs === null ? "—" : `${backendLatencyMs}ms`}
        </span>
      </div>
    </div>
  );
}
