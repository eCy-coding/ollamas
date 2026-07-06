import React from "react";
import { Music, Cpu, ListChecks, Package, AlertTriangle } from "lucide-react";
import { useOrchestra } from "./useOrchestra";

// $0 conductor live panel — mirrors Terminal.app (`ollamas status/progress/deps`) on localhost:3000.
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

export function OrchestraPanel(): React.ReactElement {
  const o = useOrchestra();
  const p = o.progress;
  const donePct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  const propPct = p && p.total ? Math.round((p.proposed / p.total) * 100) : 0;
  const onLocal = !!o.conductorModel && o.conductorModel === o.preferredModel;

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg mt-6">
      <div className="flex items-center gap-2.5 mb-4">
        <Music className="w-4 h-4 text-status-accent" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Orchestra — $0 Conductor</h2>
        <span className={`text-[10px] font-mono ml-auto ${o.live ? "text-status-ok" : "text-immersive-text-dim"}`}>{o.live ? "● live" : "○ idle"}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Phase" value={o.phase ?? "—"} sub={o.currentTask ? `task: ${o.currentTask.slice(0, 22)}` : `queue ${o.queue}`} Icon={Music} />
        <Tile label="Conductor" value={o.conductorModel ?? "—"} sub={onLocal ? "$0 local (preferred)" : o.preferredModel ? `pref ${o.preferredModel}` : ""} tone={onLocal ? "ok" : "warn"} Icon={Cpu} />
        <Tile label="Failover" value={String(o.failoverCount)} sub={o.retry ? `retry ${o.retry.count}/${o.retry.max}` : ""} tone={o.failoverCount > 0 ? "warn" : "ok"} Icon={AlertTriangle} />
        <Tile label="Deps" value={o.deps ? `${o.deps.present}/${o.deps.total}` : "—"} sub="brew/macOS" tone={o.deps && o.deps.present === o.deps.total ? "ok" : "warn"} Icon={Package} />
      </div>

      {p ? (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-immersive-text-dim mb-1.5">
            <ListChecks className="w-3 h-3 text-status-accent" /> Completion — {p.done}/{p.total} done · {p.proposed} proposed · {p.pending} pending
          </div>
          <div className="h-2.5 w-full bg-immersive-inset border border-immersive-border rounded overflow-hidden flex">
            <div className="h-full bg-status-ok" style={{ width: `${donePct}%` }} />
            <div className="h-full bg-status-accent/50" style={{ width: `${propPct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
