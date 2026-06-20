import React, { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, ToggleLeft, ToggleRight, Loader2, ListFilter } from "lucide-react";
import { SecurityEvent } from "../types";
import { api, ApiError } from "../lib/apiClient";

interface PoliciesProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
  permissions: {
    fileRead: boolean;
    fileWrite: boolean;
    commandExec: boolean;
    git: boolean;
  };
  onPermissionsChange: () => void;
}

export const SecurityPolicies: React.FC<PoliciesProps> = ({ onNotify, permissions, onPermissionsChange }) => {
  const [logs, setLogs] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const fetchLogs = async () => {
    setLoading(true);
    try {
      setLogs((await api.get("/api/security/log")) as SecurityEvent[]);
    } catch (e) {
      console.error("Failed to fetch security logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleToggle = async (key: string, currentVal: boolean) => {
    const updated = {
      fileRead: key === "fileRead" ? !currentVal : permissions.fileRead,
      fileWrite: key === "fileWrite" ? !currentVal : permissions.fileWrite,
      commandExec: key === "commandExec" ? !currentVal : permissions.commandExec,
      git: key === "git" ? !currentVal : permissions.git,
    };

    try {
      await api.post("/api/security/permissions", updated);
      onNotify("Security permissions adjusted successfully!", "success");
      onPermissionsChange();
      fetchLogs();
    } catch (e: any) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify(e.message, "error");
      }
    }
  };

  const getStatusColor = (status: SecurityEvent["status"]) => {
    switch (status) {
      case "allow": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "deny": return "text-rose-400 bg-rose-500/10 border-rose-500/20 font-bold";
      case "warning": return "text-amber-400 bg-amber-500/10 border-amber-500/20";
      default: return "text-immersive-text-muted bg-immersive-bg border-immersive-border";
    }
  };

  const filteredLogs = logs.filter((l) => filter === "all" || l.category === filter);

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg">
      <div className="flex items-center gap-2.5 mb-4">
        <ShieldCheck className="w-4 h-4 text-indigo-400" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Security & Permissions Journal</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* Permission Toggle Cards */}
        <div className="bg-immersive-inset border border-immersive-border p-4 rounded space-y-4">
          <h3 className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">Active Guardrails</h3>
          
          <div className="space-y-3.5 text-xs">
            {/* File Read Override */}
            <div className="flex items-center justify-between bg-immersive-inset p-2.5 rounded border border-immersive-border">
              <div>
                <span className="font-mono font-bold text-immersive-text-bright block">Workspace File Read</span>
                <span className="text-[10px] text-immersive-text-dim">Allow AI agents to read files recursively</span>
              </div>
              <button onClick={() => handleToggle("fileRead", permissions.fileRead)}>
                {permissions.fileRead ? (
                  <ToggleRight className="w-8 h-8 text-emerald-400 cursor-pointer" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-immersive-text-dim cursor-pointer" />
                )}
              </button>
            </div>

            {/* File Write Override */}
            <div className="flex items-center justify-between bg-immersive-inset p-2.5 rounded border border-immersive-border">
              <div>
                <span className="font-mono font-bold text-immersive-text-bright block">Workspace File Write</span>
                <span className="text-[10px] text-immersive-text-dim">Allow AI agents to rewrite and clean modules</span>
              </div>
              <button onClick={() => handleToggle("fileWrite", permissions.fileWrite)}>
                {permissions.fileWrite ? (
                  <ToggleRight className="w-8 h-8 text-emerald-400 cursor-pointer" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-immersive-text-dim cursor-pointer" />
                )}
              </button>
            </div>

            {/* Terminal Command Exec Override */}
            <div className="flex items-center justify-between bg-immersive-inset p-2.5 rounded border border-immersive-border">
              <div>
                <span className="font-mono font-bold text-immersive-text-bright block">Local Command execution</span>
                <span className="text-[10px] text-immersive-text-dim">Allow running tests (allowlist sandbox enforced)</span>
              </div>
              <button onClick={() => handleToggle("commandExec", permissions.commandExec)}>
                {permissions.commandExec ? (
                  <ToggleRight className="w-8 h-8 text-emerald-400 cursor-pointer" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-immersive-text-dim cursor-pointer" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Real-time security events listing */}
        <div className="bg-immersive-inset border border-immersive-border p-4 rounded space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">Real-Time Event Logs</h3>
            <div className="flex items-center gap-2">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="bg-immersive-bg border border-immersive-border rounded px-1.5 py-0.5 text-[10px] font-mono text-immersive-text-muted focus:outline-none"
              >
                <option value="all">Filters: All</option>
                <option value="file_system">File System</option>
                <option value="command_exec">Terminal Run</option>
                <option value="network">Backups/Network</option>
                <option value="permission_change">Permissions</option>
              </select>
              <button onClick={fetchLogs} disabled={loading} className="text-immersive-text-muted hover:text-immersive-text-bright cursor-pointer">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="bg-immersive-inset border border-immersive-border rounded p-3 max-h-52 overflow-y-auto space-y-2 text-[10px] font-mono">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-10 text-immersive-text-dim italic font-mono">No security events triggered.</div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="border-b border-immersive-border pb-2 last:border-0 last:pb-0 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className={`px-1.5 py-0.2 rounded border uppercase text-[8px] font-bold ${getStatusColor(log.status)}`}>
                      {log.status}
                    </span>
                    <span className="text-immersive-text-dim font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <span className="text-immersive-text-bright block font-semibold truncate leading-tight">{log.action}</span>
                  <p className="text-immersive-text-muted break-words leading-tight">{log.details}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
