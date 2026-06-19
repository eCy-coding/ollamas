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
    <div className="bg-[#08090d] border border-white/5 rounded p-5 flex flex-col justify-between shadow-lg">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <h2 className="text-xs font-bold text-slate-100 font-mono tracking-wider uppercase">Interactive Sandbox Terminal</h2>
          </div>
          {!isLive && (
            <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 font-mono">
              EMULATOR OUTS
            </span>
          )}
        </div>

        {/* Console Box */}
        <div className="bg-black/55 border border-white/5 rounded p-4 min-h-[190px] max-h-[240px] overflow-y-auto font-mono text-xs text-slate-300 space-y-1.5" ref={scrollRef}>
          {logs.map((log, index) => (
            <div key={index} className="whitespace-pre-wrap leading-relaxed">
              {log.startsWith("$") ? (
                <span className="text-indigo-400 font-bold">{log}</span>
              ) : log.startsWith("[FAIL]") ? (
                <span className="text-rose-400 font-medium">{log}</span>
              ) : (
                <span>{log}</span>
              )}
            </div>
          ))}
          {loading && (
            <div className="text-indigo-400 animate-pulse font-bold">Executing task subprocess...</div>
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
              className="text-[10px] font-mono bg-[#050608] hover:bg-indigo-500/10 border border-white/5 rounded px-2.5 py-1 text-slate-400 hover:text-indigo-400 transition cursor-pointer disabled:opacity-50"
            >
              {act.cmd}
            </button>
          ))}
        </div>

        {/* Input Field */}
        <div className="flex items-center gap-3 bg-black/55 border border-white/5 rounded px-3 py-2 transition focus-within:border-indigo-505/50">
          <span className="text-xs text-indigo-500 font-bold font-mono">$</span>
          <input
            type="text"
            value={command}
            disabled={loading}
            onKeyDown={handleKeyPress}
            onChange={(e) => setCommand(e.target.value)}
            placeholder='Type target binary command here (e.g. pytest, git status)...'
            className="flex-1 bg-transparent text-xs text-slate-200 font-mono focus:outline-none placeholder-slate-700"
          />
          <button 
            onClick={() => { runCommand(command); setCommand(""); }}
            disabled={loading || !command.trim()}
            className="text-indigo-400 hover:text-indigo-300 disabled:text-slate-700 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>

        {/* Help block */}
        <div className="mt-3 flex gap-1.5 items-center text-[10px] text-slate-500 font-mono">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-600" />
          <span>Allowlist locks sandbox commands parameters. Blocking redirects, sudo, curl or file removals (rm).</span>
        </div>
      </div>
    </div>
  );
};
