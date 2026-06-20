import React, { useState, useRef, useEffect } from "react";
import { Terminal, Play, ShieldAlert, AlertOctagon, HelpCircle } from "lucide-react";
import { api } from "../lib/apiClient";

interface TerminalProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
  isLive: boolean;
}

export const CommandLineTerminal: React.FC<TerminalProps> = ({ onNotify, isLive }) => {
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<string[]>(["Session initialized. Ready for telemetry..."]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const runCommand = async (cmdStr: string) => {
    if (!cmdStr.trim()) return;
    setLoading(true);
    setLogs((prev) => [...prev, `$ ${cmdStr}`]);

    try {
      const data: any = await api.post("/api/terminal", { command: cmdStr });

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
      </div>
    </div>
  );
};
