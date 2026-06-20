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
import { ThemeToggle } from "./components/ThemeToggle";
import { LanguageToggle } from "./components/LanguageToggle";
import { ObservabilityPanel } from "./components/ObservabilityPanel";
import { UsagePanel } from "./components/UsagePanel";
import { OfflineBadge } from "./components/OfflineBadge";
import { CapabilityProvider, CapabilityGate } from "./components/CapabilityGate";
import { isTabEnabled } from "./lib/capabilities";
import { useLingui } from "@lingui/react";
import { api } from "./lib/apiClient";
import { HealthTelemetry } from "./types";
import {
  Cpu, Key, Sparkles, FolderOpen, Terminal,
  ShieldCheck, CloudLightning, BadgeInfo, Bell, X, Info, Network,
  MousePointer2, Building2, Lock
} from "lucide-react";

// vF11 — shown in a gated tab's body when the backend has not granted the
// required permission (defense-in-depth; the tab button is also disabled).
function CapabilityDenied({ capKey, onOpen }: { capKey: string; onOpen: () => void }) {
  const { _ } = useLingui();
  return (
    <div className="bg-immersive-panel border border-immersive-border rounded p-6 text-center space-y-3 animate-fade-in">
      <Lock className="w-6 h-6 mx-auto text-status-warn" />
      <h3 className="text-sm font-bold font-mono text-immersive-text-bright">{_('app.cap.deniedTitle')}</h3>
      <p className="text-xs text-immersive-text-muted">{_('app.cap.deniedBody')} ({_(capKey)})</p>
      <button
        type="button"
        onClick={onOpen}
        className="text-xs border border-immersive-border rounded px-3 py-1.5 text-immersive-text-muted hover:text-immersive-text-bright transition-colors"
      >
        {_('app.cap.openSecurity')}
      </button>
    </div>
  );
}

export default function App() {
  const [telemetry, setTelemetry] = useState<HealthTelemetry | null>(null);
  const [activeTab, setActiveTab] = useState<string>("telemetry");
  const [notifications, setNotifications] = useState<{ id: string; msg: string; type: "success" | "error" | "info" }[]>([]);
  const { _ } = useLingui();
  const perms = telemetry?.permissions ?? null; // vF11 — backend-granted capabilities (deny-by-default until known)

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
      const data = await api.get("/api/health");
      setTelemetry(data as unknown as HealthTelemetry);
    } catch (e) {
      console.warn("Telemetry endpoint is sleeping or offline.");
    }
  };

  useEffect(() => {
    fetchTelemetry(true);
    const interval = setInterval(() => fetchTelemetry(false), 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Tab labels resolve via i18n at render: `_(`app.tab.${id}`)` (vF9).
  const tabs = [
    { id: "telemetry", icon: <Cpu className="w-4 h-4" /> },
    { id: "swarm", icon: <Network className="w-4 h-4 text-cyan-400" /> },
    { id: "saas", icon: <Building2 className="w-4 h-4 text-cyan-300" /> },
    { id: "pipeline", icon: <Sparkles className="w-4 h-4 text-purple-400" /> },
    { id: "react-agent", icon: <Sparkles className="w-4 h-4 text-pink-400" /> },
    { id: "files", icon: <FolderOpen className="w-4 h-4 text-blue-400" /> },
    { id: "drive", icon: <CloudLightning className="w-4 h-4 text-sky-400" /> },
    { id: "terminal", icon: <Terminal className="w-4 h-4 text-emerald-400" /> },
    { id: "keys", icon: <Key className="w-4 h-4 text-indigo-400" /> },
    { id: "security", icon: <ShieldCheck className="w-4 h-4 text-teal-400" /> },
    { id: "backup", icon: <CloudLightning className="w-4 h-4 text-amber-400" /> },
    { id: "automation", icon: <MousePointer2 className="w-4 h-4 text-orange-400" /> },
    { id: "selftest", icon: <BadgeInfo className="w-4 h-4 text-rose-400" /> },
  ];

  // Map header status badge
  const getHeaderBadge = () => {
    if (!telemetry) return <span className="text-immersive-text-dim animate-pulse text-xs font-mono">CONNECTING...</span>;
    if (telemetry.mode === "live") {
      const activeCount = telemetry.metrics?.loadedModels?.length || 0;
      return (
        <span className="flex items-center gap-1.5 text-xs text-status-ok bg-emerald-500/10 border border-emerald-500/25 px-3 py-1 rounded-full font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          LIVE · {activeCount > 0 ? `${activeCount} models active` : "Ollama online"}
        </span>
      );
    }
    if (telemetry.mode === "degraded-live") {
      return (
        <span className="flex items-center gap-1.5 text-xs text-status-warn bg-amber-500/15 border border-amber-500/20 px-3 py-1 rounded-full font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          DEGRADED · Ollama offline
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-xs text-immersive-text-muted bg-immersive-panel border border-immersive-border px-3 py-1 rounded-full font-mono font-medium">
        <span className="w-2 h-2 rounded-full bg-slate-500 animate-ping"></span>
        DEMO · Cloud Sandbox (Emulated)
      </span>
    );
  };

  return (
    <CapabilityProvider permissions={perms}>
    <div className="min-h-screen flex flex-col font-sans transition-colors duration-300 bg-immersive-bg text-immersive-text-muted">
      
      {/* Dynamic Toast Notifications (Corner Overlay) */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {notifications.map((n) => (
          <div 
            key={n.id} 
            className={`p-3.5 rounded border flex items-center justify-between shadow-2xl transition duration-300 text-xs font-mono ${
              n.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-status-ok" :
              n.type === "error" ? "bg-red-500/10 border-red-500/20 text-status-err" :
              "bg-indigo-500/10 border-indigo-500/20 text-status-accent"
            }`}
          >
            <div className="flex gap-2">
              <span className="font-bold">[{n.type.toUpperCase()}]</span>
              <span>{n.msg}</span>
            </div>
            <button aria-label="Dismiss notification" onClick={() => setNotifications((prev) => prev.filter((p) => p.id !== n.id))} className="ml-3 hover:text-immersive-text-bright shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Global Header */}
      <header className="border-b h-14 px-6 flex items-center justify-between gap-4 border-immersive-border bg-immersive-sidebar">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-immersive-text-bright shadow-lg">
            <div className="w-4 h-4 border-2 border-white/90 rotate-45"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs font-bold tracking-widest text-status-accent uppercase leading-none flex items-center gap-2">
              LLM Mission Control
              <span className="text-[9px] font-mono text-status-info bg-cyan-500/10 border border-cyan-500/20 px-1 py-0.5 rounded">V1.0</span>
            </h1>
            <span className="text-xs text-immersive-text-muted font-semibold mt-0.5">E2E_ORCHESTRATOR_V3</span>
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          <OfflineBadge />
          {getHeaderBadge()}
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      {/* Master Content Segment */}
      <main className="flex-1 w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Side Sidebar / Tab Controls */}
        <div className="lg:col-span-1 space-y-4">
          <div className="p-4 rounded border bg-immersive-sidebar border-immersive-border">
            <span className="text-[10px] text-immersive-text-dim font-mono uppercase block mb-3.5 tracking-widest font-bold">{_('app.sidebar.explorer')}</span>
            <nav aria-label="Primary" className="flex flex-col gap-1.5">
              {tabs.map((tab) => {
                const enabled = isTabEnabled(tab.id, perms);
                return (
                <button
                  key={tab.id}
                  onClick={() => { if (enabled) setActiveTab(tab.id); }}
                  disabled={!enabled}
                  aria-disabled={!enabled}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  title={enabled ? undefined : _('app.cap.locked')}
                  className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium font-mono transition-all text-left ${
                    activeTab === tab.id
                      ? "bg-indigo-500/10 text-status-accent border border-indigo-500/20"
                      : "text-immersive-text-muted hover:text-immersive-text-bright hover:bg-white/5"
                  } ${enabled ? "" : "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-immersive-text-muted"}`}
                >
                  {enabled ? tab.icon : <Lock className="w-4 h-4 shrink-0" />}
                  <span>{_(`app.tab.${tab.id}`)}</span>
                </button>
                );
              })}
            </nav>
          </div>

          {/* Setup Guide / Demowizard (M10, AC-32) */}
          {telemetry?.mode === "demo" && (
            <div className="bg-immersive-sidebar border border-immersive-border rounded p-4 space-y-3">
              <div className="flex items-center gap-2 text-status-accent">
                <Info className="w-4 h-4 shrink-0" />
                <h3 className="text-[10px] block font-bold font-mono tracking-widest uppercase">SETUP WORKSPACE WIZARD</h3>
              </div>
              <p className="text-[11px] leading-relaxed text-immersive-text-muted">
                You are executing in our cloud playground container context. Local MacBook system access is restricted.
              </p>
              <div className="space-y-2 text-[10px] bg-immersive-inset border border-immersive-border p-3 rounded font-mono">
                <span className="text-immersive-text-muted font-bold block">Deploy on macOS Workstation:</span>
                <ol className="list-decimal pl-4 text-immersive-text-muted space-y-1">
                  <li>Download repository Zip using **Export** menu in AI Studio.</li>
                  <li>Extract download folder.</li>
                  <li>In terminal, execute: <code className="text-status-accent font-bold font-mono">./install.sh</code></li>
                  <li>Open browser directly at <code className="text-immersive-text-bright">http://localhost:3000</code></li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Center Panels Body */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Top Status Indicators bar */}
          <div className="bg-immersive-sidebar border border-immersive-border rounded px-4 py-3 flex flex-wrap md:flex-nowrap items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-immersive-text-dim">{_('app.status.activeHost')}</span>
              <span className="text-immersive-text-muted font-semibold">{telemetry ? telemetry.os.platform : "Loading..."}</span>
            </div>
            <div className="hidden md:block text-immersive-text-dim">|</div>
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-immersive-text-dim">{_('app.status.workspace')}</span>
              <span className="text-immersive-text-muted truncate font-semibold" title={telemetry?.workspacePath}>{telemetry ? telemetry.workspacePath : "Connecting..."}</span>
            </div>
          </div>

          {/* Dynamic Tab Mounting */}
          {activeTab === "telemetry" && (
            <div className="space-y-6 animate-fade-in">
              <TelemetryCockpit telemetry={telemetry} onRefresh={fetchTelemetry} />
              <ObservabilityPanel />
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
              <CapabilityGate need="fileRead" fallback={<CapabilityDenied capKey="app.cap.fileRead" onOpen={() => setActiveTab("security")} />}>
                <WorkspaceTree
                  onNotify={notify}
                  activePath={telemetry ? telemetry.workspacePath : ""}
                  onPathChange={(newPath) => setTelemetry((p) => p ? { ...p, workspacePath: newPath } : null)}
                  isLive={telemetry ? telemetry.mode !== "demo" : false}
                />
              </CapabilityGate>
            </div>
          )}

          {activeTab === "drive" && (
            <div className="animate-fade-in">
              <GoogleDriveBrowser />
            </div>
          )}

          {activeTab === "terminal" && (
            <div className="animate-fade-in">
              <CapabilityGate need="commandExec" fallback={<CapabilityDenied capKey="app.cap.commandExec" onOpen={() => setActiveTab("security")} />}>
                <CommandLineTerminal
                  onNotify={notify}
                  isLive={telemetry ? telemetry.mode !== "demo" : false}
                />
              </CapabilityGate>
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
              <CapabilityGate need="fileWrite" fallback={<CapabilityDenied capKey="app.cap.fileWrite" onOpen={() => setActiveTab("security")} />}>
                <BackupControl onNotify={notify} />
              </CapabilityGate>
            </div>
          )}

          {activeTab === "automation" && (
            <div className="animate-fade-in">
              <CapabilityGate need="commandExec" fallback={<CapabilityDenied capKey="app.cap.commandExec" onOpen={() => setActiveTab("security")} />}>
                <VirtualController />
              </CapabilityGate>
            </div>
          )}

          {activeTab === "swarm" && (
            <div className="animate-fade-in">
              <ClusterManager onNotify={notify} />
            </div>
          )}

          {activeTab === "saas" && (
            <div className="animate-fade-in space-y-6">
              <UsagePanel />
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
      <footer className="border-t px-6 py-4 text-center text-xs font-mono tracking-wider border-immersive-border bg-immersive-bg text-immersive-text-dim">
        <p>{_('app.footer.copyright')}</p>
      </footer>
    </div>
    </CapabilityProvider>
  );
}
