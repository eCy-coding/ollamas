import React, { useEffect, useState } from "react";
import { Sparkles, Loader2, CheckCircle2, ShieldAlert, AlertTriangle, Play } from "lucide-react";
import { SelfTestReport, TestGateReport } from "../types";
import { api } from "../lib/apiClient";

export const SelfTestGates: React.FC = () => {
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [loading, setLoading] = useState(false);

  const runTests = async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/selftest");
      setReport(data as SelfTestReport);
    } catch (e) {
      console.error("Self test routing failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runTests();
  }, []);

  const getStatusStyle = (status: TestGateReport["status"]) => {
    switch (status) {
      case "PASS":
        return "bg-emerald-500/10 border-emerald-500/25 text-emerald-400";
      case "FAIL":
        return "bg-rose-500/10 border-rose-500/25 text-rose-400";
      case "WARN":
      default:
        return "bg-amber-500/10 border-amber-500/25 text-amber-400";
    }
  };

  const getStatusIcon = (status: TestGateReport["status"]) => {
    switch (status) {
      case "PASS":
        return <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
      case "FAIL":
        return <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />;
      case "WARN":
      default:
        return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
    }
  };

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Verification Gates Control panel (§9 Compliance)</h2>
        </div>
        <button
          onClick={runTests}
          disabled={loading}
          className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono font-medium text-xs rounded px-3 py-1.5 disabled:opacity-50 transition flex items-center gap-1"
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          Run Verification Probes
        </button>
      </div>

      <div className="flex gap-2.5 bg-immersive-inset border border-immersive-border p-3 rounded mb-6 text-[10px] text-immersive-text-muted font-mono">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="leading-relaxed">
          Operational policy: If any verification gate reports <span className="text-rose-400">FAIL</span>, the environment is 
          non-compliant for live deployments. For cloud instances, <span className="text-amber-400">WARN</span> mode is standard for 
          unbound local resources.
        </p>
      </div>

      {!report ? (
        <div className="text-center py-10 text-immersive-text-dim text-xs flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <span>Running compliance test protocols on host container...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(report).map(([gateName, gateObj]) => {
            const gate = gateObj as TestGateReport;
            return (
              <div key={gateName} className={`border p-4 rounded flex items-start gap-3.5 justify-between ${getStatusStyle(gate.status)}`}>
                <div className="space-y-1 overflow-hidden">
                  <span className="text-xs font-mono font-bold block leading-tight text-immersive-text-bright">{gateName.replace("_", " ")}</span>
                  <p className="text-[10px] font-mono leading-relaxed text-immersive-text-muted break-words">{gate.details}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {getStatusIcon(gate.status)}
                  <span className="text-xs font-bold font-mono">{gate.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
