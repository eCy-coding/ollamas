import { useEffect, useState } from "react";
import { 
  TelemetryCockpit 
} from "./components/TelemetryCockpit";
import { KeyVault } from "./components/KeyVault";
import { MultiAgentPipeline } from "./components/MultiAgentPipeline";
import { ReactAgentTab } from "./components/ReactAgentTab";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { GoogleDriveBrowser } from "./components/GoogleDriveBrowser";
import { CommandLineTerminal } from "./components/CommandLineTerminal";
import { BackupControl } from "./components/BackupControl";
import { SelfTestGates } from "./components/SelfTestGates";
import { SecurityPolicies } from "./components/SecurityPolicies";
import { ClusterManager } from "./components/ClusterManager";
import { VirtualController } from "./components/VirtualController";
import { SaaSAdmin } from "./components/SaaSAdmin";
import { HealthTelemetry } from "./types";
import { 
  Cpu, Key, Sparkles, FolderOpen, Terminal, 
  ShieldCheck, CloudLightning, BadgeInfo, Bell, X, Info, Network,
  MousePointer2, Building2
} from "lucide-react";

export default function App() {
  const [telemetry, setTelemetry] = useState<HealthTelemetry | null>(null);
  const [activeTab, setActiveTab] = useState<string>("telemetry");
  const [notifications, setNotifications] = useState<{ id: string; msg: string; type: "success" | "error" | "info" }[]>([]);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");

  const notify = (msg: string, type: "success" | "error" | "info" = "info") => {
    const id = Math.random().toString(36).slice(2, 9);
    setNotifications((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  };

  const fetchTelemetry = async (force: boolean = false) => {
    // Skip if page is hidden to conserve Mac energy (Performance Budget §6), unless forced initially
    if (document.hidden && !force) return;
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch (e) {
      console.warn("Telemetry endpoint is sleeping or offline.");
    }
  };

  useEffect(() => {
    fetchTelemetry(true);
    const interval = setInterval(() => fetchTelemetry(false), 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const tabs = [
    { id: "telemetry", label: "Cockpit Dashboard", icon: <Cpu className="w-4 h-4" /> },
    { id: "swarm", label: "P2P Computing Swarm", icon: <Network className="w-4 h-4 text-cyan-400" /> },
    { id: "saas", label: "SaaS Gateway", icon: <Building2 className="w-4 h-4 text-cyan-300" /> },
    { id: "pipeline", label: "Pipeline Agent", icon: <Sparkles className="w-4 h-4 text-purple-400" /> },
    { id: "react-agent", label: "ReAct Specialist", icon: <Sparkles className="w-4 h-4 text-pink-400" /> },
    { id: "files", label: "Files Explorer", icon: <FolderOpen className="w-4 h-4 text-blue-400" /> },
    { id: "drive", label: "Google Drive", icon: <CloudLightning className="w-4 h-4 text-sky-400" /> },
    { id: "terminal", label: "Interactive CLI", icon: <Terminal className="w-4 h-4 text-emerald-400" /> },
    { id: "keys", label: "Hardware Vault", icon: <Key className="w-4 h-4 text-indigo-400" /> },
    { id: "security", label: "Guard Policies", icon: <ShieldCheck className="w-4 h-4 text-teal-400" /> },
    { id: "backup", label: "AES Cloud Backup", icon: <CloudLightning className="w-4 h-4 text-amber-400" /> },
    { id: "automation", label: "Virtual Controller", icon: <MousePointer2 className="w-4 h-4 text-orange-400" /> },
    { id: "selftest", label: "Verify Gates", icon: <BadgeInfo className="w-4 h-4 text-rose-400" /> },
  ];

  // Map header status badge
  const getHeaderBadge = () => {
    if (!telemetry) return <span className="text-slate-500 animate-pulse text-xs font-mono">CONNECTING...</span>;
    if (telemetry.mode === "live") {
      const activeCount = telemetry.metrics?.loadedModels?.length || 0;
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1 rounded-full font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          LIVE · {activeCount > 0 ? `${activeCount} models active` : "Ollama online"}
        </span>
      );
    }
    if (telemetry.mode === "degraded-live") {
      return (
        <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/15 border border-amber-500/20 px-3 py-1 rounded-full font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          DEGRADED · Ollama offline
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full font-mono font-medium">
        <span className="w-2 h-2 rounded-full bg-slate-500 animate-ping"></span>
        DEMO · Cloud Sandbox (Emulated)
      </span>
    );
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 ${
      themeMode === "dark" 
        ? "bg-[#050608] text-slate-300" 
        : "bg-slate-50 text-slate-900"
    }`}>
      
      {/* Dynamic Toast Notifications (Corner Overlay) */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {notifications.map((n) => (
          <div 
            key={n.id} 
            className={`p-3.5 rounded border flex items-center justify-between shadow-2xl transition duration-300 text-xs font-mono ${
              n.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" :
              n.type === "error" ? "bg-red-500/10 border-red-500/20 text-red-300" :
              "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"
            }`}
          >
            <div className="flex gap-2">
              <span className="font-bold">[{n.type.toUpperCase()}]</span>
              <span>{n.msg}</span>
            </div>
            <button onClick={() => setNotifications((prev) => prev.filter((p) => p.id !== n.id))} className="ml-3 hover:text-white shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Global Header */}
      <header className={`border-b h-14 px-6 flex items-center justify-between gap-4 ${
        themeMode === "dark" ? "border-white/5 bg-[#08090d]" : "border-slate-200 bg-white"
      }`}>
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white shadow-lg">
            <div className="w-4 h-4 border-2 border-white/90 rotate-45"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs font-bold tracking-widest text-indigo-400 uppercase leading-none flex items-center gap-2">
              LLM Mission Control
              <span className="text-[9px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-1 py-0.5 rounded">V1.0</span>
            </h1>
            <span className="text-xs text-slate-400 font-semibold mt-0.5">E2E_ORCHESTRATOR_V3</span>
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          {getHeaderBadge()}
          <button 
            onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            className="text-slate-400 hover:text-white text-xs border border-white/10 rounded px-2.5 py-1 whitespace-nowrap"
          >
            {themeMode === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
      </header>

      {/* Master Content Segment */}
      <main className="flex-1 w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Side Sidebar / Tab Controls */}
        <div className="lg:col-span-1 space-y-4">
          <div className={`p-4 rounded border ${
            themeMode === "dark" ? "bg-[#08090d] border-white/5" : "bg-white border-slate-200"
          }`}>
            <span className="text-[10px] text-slate-500 font-mono uppercase block mb-3.5 tracking-widest font-bold">Project Explorer</span>
            <div className="flex flex-col gap-1.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium font-mono transition-all text-left ${
                    activeTab === tab.id 
                      ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Setup Guide / Demowizard (M10, AC-32) */}
          {telemetry?.mode === "demo" && (
            <div className="bg-[#08090d] border border-white/5 rounded p-4 space-y-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <Info className="w-4 h-4 shrink-0" />
                <h3 className="text-[10px] block font-bold font-mono tracking-widest uppercase">SETUP WORKSPACE WIZARD</h3>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                You are executing in our cloud playground container context. Local MacBook system access is restricted.
              </p>
              <div className="space-y-2 text-[10px] bg-black/40 border border-white/5 p-3 rounded font-mono">
                <span className="text-slate-300 font-bold block">Deploy on macOS Workstation:</span>
                <ol className="list-decimal pl-4 text-slate-400 space-y-1">
                  <li>Download repository Zip using **Export** menu in AI Studio.</li>
                  <li>Extract download folder.</li>
                  <li>In terminal, execute: <code className="text-indigo-400 font-bold font-mono">./install.sh</code></li>
                  <li>Open browser directly at <code className="text-white">http://localhost:3000</code></li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Center Panels Body */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Top Status Indicators bar */}
          <div className="bg-[#08090d] border border-white/5 rounded px-4 py-3 flex flex-wrap md:flex-nowrap items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-slate-500">Active Host:</span>
              <span className="text-slate-300 font-semibold">{telemetry ? telemetry.os.platform : "Loading..."}</span>
            </div>
            <div className="hidden md:block text-slate-800">|</div>
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-slate-500">Workspace:</span>
              <span className="text-slate-300 truncate font-semibold" title={telemetry?.workspacePath}>{telemetry ? telemetry.workspacePath : "Connecting..."}</span>
            </div>
          </div>

          {/* Dynamic Tab Mounting */}
          {activeTab === "telemetry" && (
            <div className="space-y-6 animate-fade-in">
              <TelemetryCockpit telemetry={telemetry} onRefresh={fetchTelemetry} />
              <SelfTestGates />
            </div>
          )}

          {activeTab === "pipeline" && (
            <div className="animate-fade-in">
              <MultiAgentPipeline 
                onNotify={notify} 
                workspacePath={telemetry ? telemetry.workspacePath : ""} 
              />
            </div>
          )}

          {activeTab === "react-agent" && (
            <div className="animate-fade-in">
              <ReactAgentTab onNotify={notify} />
            </div>
          )}

          {activeTab === "files" && (
            <div className="animate-fade-in">
              <WorkspaceTree 
                onNotify={notify} 
                activePath={telemetry ? telemetry.workspacePath : ""}
                onPathChange={(newPath) => setTelemetry((p) => p ? { ...p, workspacePath: newPath } : null)}
                isLive={telemetry ? telemetry.mode !== "demo" : false}
              />
            </div>
          )}

          {activeTab === "drive" && (
            <div className="animate-fade-in">
              <GoogleDriveBrowser />
            </div>
          )}

          {activeTab === "terminal" && (
            <div className="animate-fade-in">
              <CommandLineTerminal 
                onNotify={notify} 
                isLive={telemetry ? telemetry.mode !== "demo" : false}
              />
            </div>
          )}

          {activeTab === "keys" && (
            <div className="animate-fade-in">
              <KeyVault onNotify={notify} />
            </div>
          )}

          {activeTab === "security" && (
            <div className="animate-fade-in">
              <SecurityPolicies 
                onNotify={notify} 
                permissions={telemetry ? telemetry.permissions : { fileRead: true, fileWrite: true, commandExec: true, git: true }}
                onPermissionsChange={fetchTelemetry}
              />
            </div>
          )}

          {activeTab === "backup" && (
            <div className="animate-fade-in">
              <BackupControl onNotify={notify} />
            </div>
          )}

          {activeTab === "automation" && (
            <div className="animate-fade-in">
              <VirtualController />
            </div>
          )}

          {activeTab === "swarm" && (
            <div className="animate-fade-in">
              <ClusterManager onNotify={notify} />
            </div>
          )}

          {activeTab === "saas" && (
            <div className="animate-fade-in">
              <SaaSAdmin onNotify={notify} />
            </div>
          )}

          {activeTab === "selftest" && (
            <div className="animate-fade-in">
              <SelfTestGates />
            </div>
          )}
        </div>
      </main>

      {/* Global Footer */}
      <footer className={`border-t px-6 py-4 text-center text-xs font-mono tracking-wider ${
        themeMode === "dark" ? "border-white/5 bg-[#050608] text-slate-500" : "border-slate-200 bg-white text-slate-600"
      }`}>
        <p>© 2026 LLM Mission Control. Offline-First Privacy Secured Machine Cockpit.</p>
      </footer>
    </div>
  );
}
