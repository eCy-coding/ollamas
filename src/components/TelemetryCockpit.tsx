import React, { useEffect, useState } from "react";
import { HealthTelemetry } from "../types";
import { Cpu, Zap, Server, Radio, RotateCw } from "lucide-react";
import { Skeleton } from "./Skeleton";
import { Sparkline } from "./Sparkline";
import { LiveActivityPanel } from "./cockpit/LiveActivityPanel";
import { ModelsPanel } from "./cockpit/ModelsPanel";
import { CouncilPanel } from "./cockpit/CouncilPanel";

interface CockpitProps {
  telemetry: HealthTelemetry | null;
  onRefresh: () => void;
}

export const TelemetryCockpit: React.FC<CockpitProps> = ({ telemetry, onRefresh }) => {
  const [cpuHistory, setCpuHistory] = useState<number[]>(new Array(15).fill(0));

  useEffect(() => {
    if (telemetry) {
      setCpuHistory((prev) => {
        const next = [...prev.slice(1), telemetry.metrics.cpuLoad1Min * 10];
        return next;
      });
    }
  }, [telemetry]);

  if (!telemetry) {
    // Reserve the SAME height as the populated cockpit (3-col grid + backend/fleet
    // panel) so the skeleton→data swap doesn't shift the page (CLS=0).
    return (
      <div aria-busy="true" aria-label="Loading host telemetry" className="space-y-4 min-h-[50rem]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="p-4 bg-immersive-panel border border-immersive-border rounded flex flex-col gap-3 min-h-[11rem]">
              <Skeleton width="50%" height="0.9rem" />
              <Skeleton width="100%" height="2.5rem" count={2} />
            </div>
          ))}
        </div>
        <div className="p-4 bg-immersive-panel border border-immersive-border rounded min-h-[5.5rem]">
          <Skeleton width="40%" height="0.9rem" />
          <div className="mt-2"><Skeleton width="70%" height="1.2rem" /></div>
        </div>
        <div className="p-4 bg-immersive-panel border border-immersive-border rounded min-h-[7rem]">
          <Skeleton width="40%" height="0.9rem" />
          <div className="mt-2"><Skeleton width="100%" height="3.5rem" /></div>
        </div>
        <div className="p-4 bg-immersive-panel border border-immersive-border rounded min-h-[8rem]">
          <Skeleton width="40%" height="0.9rem" />
          <div className="mt-2"><Skeleton width="100%" height="4.5rem" /></div>
        </div>
        <div className="p-4 bg-immersive-panel border border-immersive-border rounded min-h-[10rem]">
          <Skeleton width="40%" height="0.9rem" />
          <div className="mt-2"><Skeleton width="100%" height="6rem" /></div>
        </div>
      </div>
    );
  }

  const { mode, metrics, os: osInfo, workspacePath, permissions, backend, fleet } = telemetry;
  // LIVE when the last frame carries a fresh SSE timestamp; POLLING on /api/health fallback.
  const streamLive = typeof telemetry.updatedAt === "number" && Date.now() - telemetry.updatedAt < 6000;
  
  // Choose badge color
  const badgeColors = {
    live: "bg-emerald-500/15 border-emerald-500/25 text-status-ok",
    "degraded-live": "bg-amber-500/15 border-amber-500/25 text-status-warn",
    demo: "bg-blue-500/15 border-blue-500/25 text-status-info",
  };

  const modeLabels = {
    live: "LIVE · macOS Hardware Connected",
    "degraded-live": "DEGRADED · Ollama Offline",
    demo: "DEMO · Simulated Sandbox Mode",
  };

  const hostShort = backend ? backend.host.replace(/^https?:\/\//, "") : "";

  return (
    <div className="space-y-4 min-h-[50rem]">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* 1. Environment & Health */}
      <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded flex flex-col justify-between shadow-lg">
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">System Mode</span>
            <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${badgeColors[mode]}`}>
              {mode.toUpperCase()}
            </span>
          </div>
          <h2 className="text-sm font-bold text-immersive-text-bright mb-2 font-mono tracking-tight">{modeLabels[mode]}</h2>
          <p className="text-[10px] text-immersive-text-dim font-mono leading-relaxed truncate">
            Root Workspace: <span className="text-immersive-text-muted">{workspacePath}</span>
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-immersive-border grid grid-cols-2 gap-2 text-center">
          <div className="bg-immersive-inset p-2 rounded border border-immersive-border">
            <span className="text-[9px] text-immersive-text-dim font-mono uppercase block">OS Platform</span>
            <span className="text-xs font-semibold text-immersive-text-muted font-mono">{osInfo.platform} ({osInfo.arch})</span>
          </div>
          <div className="bg-immersive-inset p-2 rounded border border-immersive-border">
            <span className="text-[9px] text-immersive-text-dim font-mono uppercase block">Ollama Version</span>
            <span className="text-xs font-semibold text-immersive-text-muted font-mono truncate block" title={metrics.ollamaVersion}>{metrics.ollamaVersion}</span>
          </div>
        </div>
      </div>

      {/* 2. CPU & Ram Telemetry */}
      <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded shadow-lg">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">Compute Load</span>
          <div className="flex items-center gap-2 text-[10px] font-mono">
            {/* live SSE freshness vs poll-fallback — replaces the stale "polling" label */}
            <span className="flex items-center gap-1" title={streamLive ? "Live SSE stream" : "Polling fallback"}>
              <span className={`w-1.5 h-1.5 rounded-full ${streamLive ? "bg-status-ok animate-pulse" : "bg-status-warn"}`} />
              <span className={streamLive ? "text-status-ok" : "text-status-warn"}>{streamLive ? "LIVE" : "POLLING"}</span>
            </span>
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Re-sync telemetry"
              title="Re-sync telemetry"
              className="text-immersive-text-dim hover:text-immersive-text-bright transition-colors"
            >
              <RotateCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Meters */}
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs font-mono text-immersive-text-muted mb-1">
              <span>CPU Load (1 Min Avg)</span>
              <span className="font-semibold text-immersive-text-bright">{metrics.cpuLoad1Min}%</span>
            </div>
            <div className="w-full bg-immersive-inset rounded-full h-1.5 border border-immersive-border">
              <div 
                className="bg-indigo-500 h-1 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(metrics.cpuLoad1Min, 100)}%` }}
              ></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-mono text-immersive-text-muted mb-1">
              <span>Unified RAM Allocation</span>
              <span className="font-semibold text-immersive-text-bright">{metrics.memory.percentageUsed}%</span>
            </div>
            <div className="w-full bg-immersive-inset rounded-full h-1.5 border border-immersive-border">
              <div 
                className="bg-cyan-400 h-1 rounded-full transition-all duration-500" 
                style={{ width: `${metrics.memory.percentageUsed}%` }}
              ></div>
            </div>
            <span className="text-[9px] text-immersive-text-dim font-mono mt-1.5 block">
              Free: {((metrics.memory.free) / 1024 / 1024 / 1024).toFixed(1)} GB / Total: {((metrics.memory.total) / 1024 / 1024 / 1024).toFixed(1)} GB
            </span>
          </div>

          {/* Live CPU trend — fed from the SSE stream (was collected but never drawn) */}
          <div className="pt-1">
            <div className="flex justify-between text-[9px] text-immersive-text-dim font-mono uppercase tracking-widest mb-1">
              <span>CPU Trend</span><span>live</span>
            </div>
            <Sparkline data={cpuHistory} width={320} height={28} ariaLabel="CPU load trend" className="w-full text-status-accent" />
          </div>
        </div>
      </div>

      {/* 3. Safe Toggles & GPU Cache */}
      <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded flex flex-col justify-between shadow-lg">
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">Active Security</span>
            <span className="text-[8px] bg-white/5 text-immersive-text-muted font-mono px-1.5 py-0.5 rounded border border-immersive-border-strong">POLICIES ACTIVE</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-immersive-text-muted">
            <div className="flex items-center gap-2 bg-immersive-inset p-1.5 rounded border border-immersive-border">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.fileRead ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>FS Read</span>
            </div>
            <div className="flex items-center gap-2 bg-immersive-inset p-1.5 rounded border border-immersive-border">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.fileWrite ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>FS Write</span>
            </div>
            <div className="flex items-center gap-2 bg-immersive-inset p-1.5 rounded border border-immersive-border">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.commandExec ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>Safe Exec</span>
            </div>
            <div className="flex items-center gap-2 bg-immersive-inset p-1.5 rounded border border-immersive-border">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.git ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>Git Setup</span>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-immersive-border">
          <span className="text-[9px] text-immersive-text-dim font-mono uppercase block mb-1">Ollama GPU loaded models</span>
          {metrics.loadedModels && metrics.loadedModels.length > 0 ? (
            <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
              {metrics.loadedModels.map((m) => (
                <span key={m.name} className="text-[9px] font-mono bg-indigo-500/10 border border-indigo-500/20 text-status-accent px-1.5 py-0.5 rounded flex items-center gap-1">
                   <Zap className="w-2.5 h-2.5" />
                  {m.name} ({(m.size / 1024 / 1024 / 1024).toFixed(1)}GB)
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-immersive-text-dim font-mono italic">No local models currently loaded in memory</span>
          )}
        </div>
      </div>
    </div>

      {/* Active Backend & self-healing Fleet — live SSE; reserved height keeps CLS=0 */}
      <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded shadow-lg min-h-[5.5rem]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-status-accent" /> Active LLM Backend &amp; Fleet
          </span>
          {backend && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono">
              <Radio className={`w-3 h-3 ${backend.reachable ? "text-status-ok animate-pulse" : "text-status-err"}`} />
              <span className={backend.reachable ? "text-status-ok" : "text-status-err"}>{backend.reachable ? "ONLINE" : "UNREACHABLE"}</span>
            </span>
          )}
        </div>
        {backend ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-immersive-text-muted truncate" title={backend.host}>{hostShort}</span>
              <span className="text-immersive-text-dim shrink-0 ml-2">
                {backend.activeModel ? <span className="text-status-accent">{backend.activeModel}</span> : "no model loaded"}
                {backend.version && backend.version !== "unavailable" ? <span className="text-immersive-text-dim"> · v{backend.version}</span> : null}
              </span>
            </div>
            {fleet && fleet.poolSize > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {fleet.backends.map((b) => (
                  <span
                    key={b.url}
                    title={`${b.url} · priority ${b.priority}`}
                    className={`text-[9px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${
                      b.active
                        ? "bg-emerald-500/10 border-emerald-500/30 text-status-ok"
                        : "bg-white/5 border-immersive-border text-immersive-text-muted"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${b.active ? "bg-status-ok animate-pulse" : "bg-immersive-text-dim"}`} />
                    {b.name}{b.active ? " · serving" : ""}
                  </span>
                ))}
                <span className="text-[9px] font-mono text-immersive-text-dim self-center">self-healing · {fleet.poolSize} backend{fleet.poolSize > 1 ? "s" : ""}</span>
              </div>
            )}
            {telemetry.cloudProviders && telemetry.cloudProviders.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="text-[9px] font-mono text-immersive-text-dim self-center uppercase tracking-wider">cloud</span>
                {telemetry.cloudProviders.map((c) => (
                  <span
                    key={c.name}
                    title={c.ready ? `${c.name} key present — available as fleet/council backend` : `${c.name} — no API key configured`}
                    className={`text-[9px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${
                      c.ready
                        ? "bg-sky-500/10 border-sky-500/30 text-sky-300"
                        : "bg-white/5 border-immersive-border text-immersive-text-dim opacity-60"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${c.ready ? "bg-sky-400" : "bg-immersive-text-dim"}`} />
                    {c.name}{c.ready ? " ✓" : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-immersive-text-dim font-mono italic">Linking backend stream…</span>
        )}
      </div>

      {/* Real-time concurrent data — per-core CPU + live activity + backend latency (SSE) */}
      <LiveActivityPanel
        cores={telemetry.realtime?.cores ?? []}
        activity={telemetry.realtime?.activity ?? { sessionCount: 0, recentRuns: 0, lastActivityAgoSec: null }}
        backendLatencyMs={telemetry.realtime?.backendLatencyMs ?? null}
      />

      {/* All local ollama models + Mac-fit + benchmarked-efficient champion (concurrent real data) */}
      <ModelsPanel
        list={telemetry.models?.list ?? []}
        recommended={telemetry.models?.recommended ?? null}
        championTokPerSec={telemetry.models?.championTokPerSec ?? null}
        totalRamGb={telemetry.models?.totalRamGb ?? 0}
      />

      {/* Live multi-model COUNCIL calibration — dispatch real tasks, track verdicts live */}
      <CouncilPanel />
    </div>
  );
};
