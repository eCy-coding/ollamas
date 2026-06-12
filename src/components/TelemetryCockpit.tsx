import React, { useEffect, useState } from "react";
import { HealthTelemetry } from "../types";
import { Cpu, HardDrive, ShieldAlert, Wifi, Zap } from "lucide-react";

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
    return (
      <div className="p-6 text-center text-slate-400 bg-slate-900 border border-slate-800 rounded-xl animate-pulse">
        System initializes host telemetry channels...
      </div>
    );
  }

  const { mode, metrics, os: osInfo, workspacePath, permissions } = telemetry;
  
  // Choose badge color
  const badgeColors = {
    live: "bg-emerald-500/15 border-emerald-500/25 text-emerald-400",
    "degraded-live": "bg-amber-500/15 border-amber-500/25 text-amber-400",
    demo: "bg-blue-500/15 border-blue-500/25 text-blue-400",
  };

  const modeLabels = {
    live: "LIVE · macOS Hardware Connected",
    "degraded-live": "DEGRADED · Ollama Offline",
    demo: "DEMO · Simulated Sandbox Mode",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* 1. Environment & Health */}
      <div className="bg-[#08090d] border border-white/5 p-4 rounded flex flex-col justify-between shadow-lg">
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">System Mode</span>
            <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${badgeColors[mode]}`}>
              {mode.toUpperCase()}
            </span>
          </div>
          <h2 className="text-sm font-bold text-slate-100 mb-2 font-mono tracking-tight">{modeLabels[mode]}</h2>
          <p className="text-[10px] text-slate-500 font-mono leading-relaxed truncate">
            Root Workspace: <span className="text-slate-300">{workspacePath}</span>
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-center">
          <div className="bg-black/35 p-2 rounded border border-white/5">
            <span className="text-[9px] text-slate-500 font-mono uppercase block">OS Platform</span>
            <span className="text-xs font-semibold text-slate-300 font-mono">{osInfo.platform} ({osInfo.arch})</span>
          </div>
          <div className="bg-black/35 p-2 rounded border border-white/5">
            <span className="text-[9px] text-slate-500 font-mono uppercase block">Ollama Version</span>
            <span className="text-xs font-semibold text-slate-300 font-mono truncate block" title={metrics.ollamaVersion}>{metrics.ollamaVersion}</span>
          </div>
        </div>
      </div>

      {/* 2. CPU & Ram Telemetry */}
      <div className="bg-[#08090d] border border-white/5 p-4 rounded shadow-lg">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">Compute Load</span>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>Dual Core Polling</span>
          </div>
        </div>

        {/* Meters */}
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
              <span>CPU Load (1 Min Avg)</span>
              <span className="font-semibold text-white">{metrics.cpuLoad1Min}%</span>
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 border border-white/5">
              <div 
                className="bg-indigo-500 h-1 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(metrics.cpuLoad1Min, 100)}%` }}
              ></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
              <span>Unified RAM Allocation</span>
              <span className="font-semibold text-white">{metrics.memory.percentageUsed}%</span>
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 border border-white/5">
              <div 
                className="bg-cyan-400 h-1 rounded-full transition-all duration-500" 
                style={{ width: `${metrics.memory.percentageUsed}%` }}
              ></div>
            </div>
            <span className="text-[9px] text-slate-500 font-mono mt-1.5 block">
              Free: {((metrics.memory.free) / 1024 / 1024 / 1024).toFixed(1)} GB / Total: {((metrics.memory.total) / 1024 / 1024 / 1024).toFixed(1)} GB
            </span>
          </div>
        </div>
      </div>

      {/* 3. Safe Toggles & GPU Cache */}
      <div className="bg-[#08090d] border border-white/5 p-4 rounded flex flex-col justify-between shadow-lg">
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">Active Security</span>
            <span className="text-[8px] bg-white/5 text-slate-400 font-mono px-1.5 py-0.5 rounded border border-white/10">POLICIES ACTIVE</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-300">
            <div className="flex items-center gap-2 bg-black/30 p-1.5 rounded border border-white/5">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.fileRead ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>FS Read</span>
            </div>
            <div className="flex items-center gap-2 bg-black/30 p-1.5 rounded border border-white/5">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.fileWrite ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>FS Write</span>
            </div>
            <div className="flex items-center gap-2 bg-black/30 p-1.5 rounded border border-white/5">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.commandExec ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>Safe Exec</span>
            </div>
            <div className="flex items-center gap-2 bg-black/30 p-1.5 rounded border border-white/5">
              <div className={`w-1.5 h-1.5 rounded-full ${permissions.git ? "bg-cyan-400 animate-pulse" : "bg-rose-500"}`}></div>
              <span>Git Setup</span>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-white/5">
          <span className="text-[9px] text-slate-500 font-mono uppercase block mb-1">Ollama GPU loaded models</span>
          {metrics.loadedModels && metrics.loadedModels.length > 0 ? (
            <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
              {metrics.loadedModels.map((m) => (
                <span key={m.name} className="text-[9px] font-mono bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                   <Zap className="w-2.5 h-2.5" />
                  {m.name} ({(m.size / 1024 / 1024 / 1024).toFixed(1)}GB)
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-slate-500 font-mono italic">No local models currently loaded in memory</span>
          )}
        </div>
      </div>
    </div>
  );
};
