import React, { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, Play, ShieldAlert, AlertOctagon, HelpCircle, History } from "lucide-react";
import { api } from "../lib/apiClient";
import { SecurityEvent } from "../types";

interface TerminalProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
  isLive: boolean;
}

export const CommandLineTerminal: React.FC<TerminalProps> = ({ onNotify, isLive }) => {
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<string[]>(["Session initialized. Ready for telemetry..."]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SecurityEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Same audit trail SecurityPolicies.tsx reads (GET /api/security/log) — every command this
  // panel runs is already persisted there (db.logSecurity in server/terminal.ts), so a page
  // refresh doesn't lose "what did I run and was it allowed", without a second storage path.
  const loadHistory = useCallback(async () => {
    try {
      const events = (await api.get("/api/security/log")) as SecurityEvent[];
      setHistory((events || []).filter((e) => e.category === "command_exec").slice(0, 8));
    } catch {
      /* history is a convenience panel — a failed fetch shouldn't block the terminal itself */
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const runCommand = async (cmdStr: string) => {
    if (!cmdStr.trim()) return;
    setLoading(true);
    setLogs((prev) => [...prev, `$ ${cmdStr}`]);

    try {
      const data: any = (await api.post("/api/terminal", { command: cmdStr })) ?? {}; // never deref null on an empty body

      if (data.stderr) {
        setLogs((prev) => [...prev, `[FAIL] (exit: ${data.exitCode || 1}): ${data.stderr}`]);
        onNotify(`Console alert: ${data.stderr.substring(0, 50)}`, "error");
      } else if (data.stdout) {
        setLogs((prev) => [...prev, data.stdout]);
      } else {
        setLogs((prev) => [...prev, "Command executed with blank outputs."]);
      }
    } catch (e: any) {
      setLogs((prev) => [...prev, `[CONNECTION FAIL]: ${e.message}`]);
    } finally {
      setLoading(false);
      loadHistory();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      runCommand(command);
      setCommand("");
    }
  };

  const quickActions = [
    { label: "Check status", cmd: "git status" },
    { label: "Git history", cmd: "git log --oneline -n 5" },
    { label: "Verify pytest", cmd: "pytest" },
    { label: "Inspect files", cmd: "ls -la" },
    { label: "System Uname", cmd: "uname -a" },
    // Read-only ollamas subcommands (P0/P1) — the real `ollamas doctor`/`ollamas top` report
    // builders run in-process, and `ecysearcher status` only probes the subsystem's health
    // endpoint. `up`/`down` are deliberately NOT a quick-action button (they mutate docker
    // container state) — still reachable by typing the command, but not one click away.
    { label: "Stack health", cmd: "ollamas doctor" },
    { label: "Live metrics", cmd: "ollamas top" },
    { label: "eCySearcher status", cmd: "ollamas ecysearcher status" },
  ];

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 flex flex-col justify-between shadow-lg">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-status-accent" />
            <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Interactive Sandbox Terminal</h2>
          </div>
          {!isLive && (
            <span className="text-[9px] bg-amber-500/10 text-status-warn border border-amber-500/20 px-2 py-0.5 font-mono">
              EMULATOR OUTS
            </span>
          )}
        </div>

        {/* Console Box */}
        <div className="bg-immersive-inset border border-immersive-border rounded p-4 min-h-[190px] max-h-[240px] overflow-y-auto font-mono text-xs text-immersive-text-muted space-y-1.5" ref={scrollRef}>
          {logs.map((log, index) => (
            <div key={index} className="whitespace-pre-wrap leading-relaxed">
              {log.startsWith("$") ? (
                <span className="text-status-accent font-bold">{log}</span>
              ) : log.startsWith("[FAIL]") ? (
                <span className="text-status-err font-medium">{log}</span>
              ) : (
                <span>{log}</span>
              )}
            </div>
          ))}
          {loading && (
            <div className="text-status-accent animate-pulse font-bold">Executing task subprocess...</div>
          )}
        </div>
      </div>

      <div className="mt-4">
        {/* Quick action buttons */}
        <div className="flex flex-wrap gap-2 mb-3">
          {quickActions.map((act) => (
            <button
              key={act.label}
              disabled={loading}
              onClick={() => runCommand(act.cmd)}
              className="text-[10px] font-mono bg-immersive-bg hover:bg-indigo-500/10 border border-immersive-border rounded px-2.5 py-1 text-immersive-text-muted hover:text-status-accent transition cursor-pointer disabled:opacity-50"
            >
              {act.cmd}
            </button>
          ))}
        </div>

        {/* Input Field */}
        <div className="flex items-center gap-3 bg-immersive-inset border border-immersive-border rounded px-3 py-2 transition focus-within:border-indigo-505/50">
          <span className="text-xs text-status-accent font-bold font-mono">$</span>
          <input
            type="text"
            value={command}
            disabled={loading}
            onKeyDown={handleKeyPress}
            onChange={(e) => setCommand(e.target.value)}
            placeholder='Type target binary command here (e.g. pytest, git status)...'
            className="flex-1 bg-transparent text-xs text-immersive-text-bright font-mono focus:outline-none placeholder-slate-700"
          />
          <button 
            onClick={() => { runCommand(command); setCommand(""); }}
            disabled={loading || !command.trim()}
            className="text-status-accent hover:text-status-accent disabled:text-immersive-text-dim cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>

        {/* Help block */}
        <div className="mt-3 flex gap-1.5 items-center text-[10px] text-immersive-text-dim font-mono">
          <ShieldAlert className="w-3.5 h-3.5 text-immersive-text-dim" />
          <span>Allowlist locks sandbox commands parameters. Blocking redirects, sudo, curl or file removals (rm).</span>
        </div>

        {/* Recent commands (persisted audit trail — survives a page refresh, unlike `logs` above) */}
        {history.length > 0 && (
          <div className="mt-3 border-t border-immersive-border pt-3">
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-immersive-text-dim font-mono uppercase tracking-wider">
              <History className="w-3.5 h-3.5" />
              <span>Recent (audit log)</span>
            </div>
            <div className="space-y-1 max-h-[110px] overflow-y-auto">
              {history.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 text-[10px] font-mono">
                  <span className={ev.status === "deny" ? "text-status-err" : "text-immersive-text-muted"}>
                    {ev.status === "deny" ? "✕" : "✓"}
                  </span>
                  <span className="text-immersive-text-muted truncate" title={`${ev.action} — ${ev.details}`}>
                    {ev.action}
                  </span>
                  <span className="text-immersive-text-dim ml-auto shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
