import React, { useEffect, useState } from "react";
import { Play, ToggleLeft, ToggleRight, Sparkles, AlertCircle, CheckCircle2, RotateCw, Loader2, ArrowRight } from "lucide-react";
import { api } from "../lib/apiClient";

interface PipelineProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
  workspacePath: string;
}

interface StageState {
  status: "pending" | "running" | "done" | "fail";
  text: string;
  tokensPerSec?: number;
  elapsed?: number;
  fallback?: string;
}

export const MultiAgentPipeline: React.FC<PipelineProps> = ({ onNotify, workspacePath }) => {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [enableSelfImprove, setEnableSelfImprove] = useState(false);
  const [maxIterations, setMaxIterations] = useState(2);
  const [writeFiles, setWriteFiles] = useState(true);

  // Agent Role Configurations
  const [architectProv, setArchitectProv] = useState("ollama-local");
  const [architectModel, setArchitectModel] = useState("qwen3:8b");
  const [coderProv, setCoderProv] = useState("ollama-local");
  const [coderModel, setCoderModel] = useState("qwen3:8b");
  const [reviewerProv, setReviewerProv] = useState("ollama-local");
  const [reviewerModel, setReviewerModel] = useState("qwen3:8b");

  // Dynamic model dropdown lists
  const [modelsList, setModelsList] = useState<Record<string, string[]>>({});

  // Lifecycle states
  const [stages, setStages] = useState<Record<string, StageState>>({
    architect: { status: "pending", text: "" },
    coder: { status: "pending", text: "" },
    reviewer: { status: "pending", text: "" },
    self_improve: { status: "pending", text: "" },
  });

  const [writeCount, setWriteCount] = useState<number | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setRunning(false);
      onNotify("Pipeline sequence aborted.", "info");
      
      // Mark currently running stage as failed
      setStages((prev) => {
        const newStages = { ...prev };
        for (const key of Object.keys(newStages)) {
          if (newStages[key].status === "running") {
            newStages[key] = { ...newStages[key], status: "fail", text: "Aborted by user." };
          }
        }
        return newStages;
      });
    }
  };

  const providers = [
    { id: "ollama-local", label: "Ollama (Local)" },
    { id: "gemini", label: "Google Gemini" },
    { id: "openrouter", label: "OpenRouter.ai" },
    { id: "openai", label: "OpenAI GPT" },
    { id: "anthropic", label: "Anthropic Claude" },
    { id: "demo", label: "Sandbox Simulated" },
  ];

  // Dynamic model loader
  const fetchModels = async (prov: string) => {
    if (modelsList[prov]) return;
    try {
      const list: any = await api.get(`/api/models/${prov}`);
      setModelsList((prev) => ({ ...prev, [prov]: list }));
      if (list.length > 0) {
        if (prov === architectProv) setArchitectModel(list[0]);
        if (prov === coderProv) setCoderModel(list[0]);
        if (prov === reviewerProv) setReviewerModel(list[0]);
      }
    } catch (e) {
      console.error(`Failed to load models list for provider: ${prov}`);
    }
  };

  useEffect(() => {
    fetchModels(architectProv);
  }, [architectProv]);

  useEffect(() => {
    fetchModels(coderProv);
  }, [coderProv]);

  useEffect(() => {
    fetchModels(reviewerProv);
  }, [reviewerProv]);

  const handleRun = async () => {
    if (!prompt.trim()) {
      onNotify("Please supply design guidelines or requirements before running.", "error");
      return;
    }

    setRunning(true);
    setWriteCount(null);
    setStages({
      architect: { status: "pending", text: "" },
      coder: { status: "pending", text: "" },
      reviewer: { status: "pending", text: "" },
      self_improve: { status: "pending", text: "" },
    });

    try {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      let buffer = "";

      await api.streamPost(
        "/api/pipeline",
        {
          prompt,
          architectProvider: architectProv,
          architectModel,
          coderProvider: coderProv,
          coderModel,
          reviewerProvider: reviewerProv,
          reviewerModel,
          enableSelfImprove,
          maxIterations,
          writePermissions: writeFiles,
        },
        {
          signal: abortControllerRef.current.signal,
          onChunk: (chunk) => {
            buffer += chunk;
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim() || !line.startsWith("data:")) continue;
              try {
                const data = JSON.parse(line.substring(5).trim());

                if (data.stage) {
                  setStages((prev) => ({
                    ...prev,
                    [data.stage]: {
                      status: data.status,
                      text: data.text || prev[data.stage]?.text || "",
                      tokensPerSec: data.tokensPerSec !== undefined ? data.tokensPerSec : prev[data.stage]?.tokensPerSec,
                      elapsed: data.elapsed !== undefined ? data.elapsed : prev[data.stage]?.elapsed,
                      fallback: data.fallback !== undefined ? data.fallback : prev[data.stage]?.fallback,
                    },
                  }));
                }

                if (data.done) {
                  if (data.writeCount !== undefined) {
                    setWriteCount(data.writeCount);
                  }
                }

                if (data.error) {
                  setStages((prev) => {
                    const newStages = { ...prev };
                    for (const key of Object.keys(newStages)) {
                      if (newStages[key].status === "running") {
                        newStages[key] = { ...newStages[key], status: "fail", text: data.error };
                      }
                    }
                    return newStages;
                  });
                  onNotify(`Pipeline encountered error: ${data.error}`, "error");
                  break;
                }
              } catch (e) {}
            }
          },
        },
      );
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        onNotify("Pipeline sequence finished successfully!", "success");
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      
      setStages((prev) => {
        const newStages = { ...prev };
        for (const key of Object.keys(newStages)) {
          if (newStages[key].status === "running") {
            newStages[key] = { ...newStages[key], status: "fail", text: err.message };
          }
        }
        return newStages;
      });
      onNotify(`Pipeline failed to resolve: ${err.message}`, "error");
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  };

  const getStageIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />;
      case "done":
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case "fail":
        return <AlertCircle className="w-5 h-5 text-rose-400" />;
      case "pending":
      default:
        return <div className="w-5 h-5 rounded-full border border-slate-700 bg-slate-950"></div>;
    }
  };

  return (
    <div className="bg-[#08090d] border border-white/5 rounded p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-bold text-slate-100 font-mono tracking-wider uppercase">Multi-Agent Development Pipeline</h2>
        </div>
      </div>

      {/* Input Prompter */}
      <div className="mb-5">
        <label className="text-[10px] text-slate-500 font-mono tracking-widest block mb-1.5 uppercase">Prompt Requirements</label>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="E.g. Create a FastAPI microservice returning a random quote list, containing custom health checkpoints and Pytest coverages..."
          className="w-full bg-black/40 border border-white/5 rounded p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono resize-none transition-colors"
        />
      </div>

      {/* Controls & Configuration Block */}
      <h3 className="text-[10px] text-slate-500 font-mono tracking-widest block uppercase mb-2">Agent Assignments</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* Architect Role */}
        <div className="bg-black/30 border border-white/5 p-3.5 rounded flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-slate-200 block">1. Systems Architect</span>
            <span className="text-[9px] text-slate-500 block mb-2.5">Layout structures, directories mapper</span>
          </div>
          <div className="space-y-1.5">
            <select
              value={architectProv}
              onChange={(e) => setArchitectProv(e.target.value)}
              className="w-full bg-[#050608] border border-white/5 text-[10px] rounded px-1.5 py-1 text-slate-300 focus:outline-none font-mono"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={architectModel}
              onChange={(e) => setArchitectModel(e.target.value)}
              className="w-full bg-[#050608] border border-white/5 text-[10px] rounded px-1.5 py-1 text-slate-300 focus:outline-none font-mono"
            >
              {(modelsList[architectProv] || ["Loading..."]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Coder Role */}
        <div className="bg-black/30 border border-white/5 p-3.5 rounded flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-slate-200 block">2. Developer Coder</span>
            <span className="text-[9px] text-slate-500 block mb-2.5">Writes full executable code blocks</span>
          </div>
          <div className="space-y-1.5">
            <select
              value={coderProv}
              onChange={(e) => setCoderProv(e.target.value)}
              className="w-full bg-[#050608] border border-white/5 text-[10px] rounded px-1.5 py-1 text-slate-300 focus:outline-none font-mono"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={coderModel}
              onChange={(e) => setCoderModel(e.target.value)}
              className="w-full bg-[#050608] border border-white/5 text-[10px] rounded px-1.5 py-1 text-slate-300 focus:outline-none font-mono"
            >
              {(modelsList[coderProv] || ["Loading..."]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reviewer Role */}
        <div className="bg-black/30 border border-white/5 p-3.5 rounded flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-slate-200 block">3. Inspector Reviewer</span>
            <span className="text-[9px] text-slate-500 block mb-2.5">Algorithmic inspection, security audit</span>
          </div>
          <div className="space-y-1.5">
            <select
              value={reviewerProv}
              onChange={(e) => setReviewerProv(e.target.value)}
              className="w-full bg-[#050608] border border-white/5 text-[10px] rounded px-1.5 py-1 text-slate-300 focus:outline-none font-mono"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={reviewerModel}
              onChange={(e) => setReviewerModel(e.target.value)}
              className="w-full bg-[#050608] border border-white/5 text-[10px] rounded px-1.5 py-1 text-slate-300 focus:outline-none font-mono"
            >
              {(modelsList[reviewerProv] || ["Loading..."]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Advanced pipeline parameters toggles */}
      <div className="bg-black/20 border border-white/5 p-3 rounded mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Write files */}
        <div className="flex items-center justify-between">
          <div className="text-left">
            <span className="text-xs font-mono font-bold text-slate-200 block">Auto-Write Workspace Files</span>
            <span className="text-[10px] text-slate-500 block">Directly write parsed FILE structures to disk</span>
          </div>
          <button onClick={() => setWriteFiles(!writeFiles)}>
            {writeFiles ? (
              <ToggleRight className="w-8 h-8 text-indigo-400 cursor-pointer" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-slate-600 cursor-pointer" />
            )}
          </button>
        </div>

        {/* Self Improve */}
        <div className="flex items-center justify-between">
          <div className="text-left">
            <span className="text-xs font-mono font-bold text-slate-200 block">Bounded Self-Improve Loop</span>
            <span className="text-[10px] text-slate-500 block">Iterate debugger cycle when Pytest asserts fail</span>
          </div>
          <div className="flex items-center gap-1.5">
            {enableSelfImprove && (
              <input
                type="number"
                min={1}
                max={3}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
                className="w-10 bg-[#050608] border border-white/10 text-[10px] font-mono px-1 py-0.5 rounded text-white"
              />
            )}
            <button onClick={() => setEnableSelfImprove(!enableSelfImprove)}>
              {enableSelfImprove ? (
                <ToggleRight className="w-8 h-8 text-indigo-400 cursor-pointer" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-slate-600 cursor-pointer" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="text-[10px] text-slate-500 font-mono italic">
          Target Workspace: <span className="text-slate-400">{workspacePath}</span>
        </div>
        <div className="flex gap-2">
          {running && (
            <button
              onClick={handleStop}
              className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 font-mono font-bold text-xs px-5 py-2 rounded transition cursor-pointer"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono font-bold text-xs px-5 py-2 rounded disabled:opacity-50 flex items-center gap-2 cursor-pointer transition"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Execute Pipeline
          </button>
        </div>
      </div>

      {/* DAG GRAPH GRAPHICS */}
      <h3 className="text-[10px] text-slate-500 font-mono tracking-widest block uppercase mb-3">Pipeline Execution DAG (Directed Acyclic Graph)</h3>
      <div className="flex flex-col md:flex-row items-center justify-around gap-4 p-5 bg-black/40 border border-white/5 rounded mb-6">
        {/* Architect Node */}
        <div className={`p-3 rounded border flex items-center gap-3 w-48 ${
          stages.architect.status === "running" ? "bg-indigo-500/10 border-indigo-500 animate-pulse" :
          stages.architect.status === "done" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-[#08090d] border-white/5"
        }`}>
          {getStageIcon(stages.architect.status)}
          <div className="overflow-hidden">
            <span className="text-xs font-mono font-bold text-white block">Architect</span>
            <span className="text-[9px] font-mono text-slate-500 block truncate">{architectModel}</span>
            {stages.architect.tokensPerSec !== undefined && stages.architect.tokensPerSec > 0 && (
              <span className="text-[9px] font-mono text-indigo-400 block">{Number(stages.architect.tokensPerSec).toFixed(1)} tokens/s</span>
            )}
            {stages.architect.fallback && stages.architect.status === "running" && (
              <span className="text-[8px] font-mono text-amber-500 block truncate" title={stages.architect.fallback}>{stages.architect.fallback}</span>
            )}
          </div>
        </div>

        <ArrowRight className="w-5 h-5 text-slate-700 hidden md:block" />

        {/* Coder Node */}
        <div className={`p-3 rounded border flex items-center gap-3 w-48 ${
          stages.coder.status === "running" ? "bg-indigo-500/10 border-indigo-500 animate-pulse" :
          stages.coder.status === "done" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-[#08090d] border-white/5"
        }`}>
          {getStageIcon(stages.coder.status)}
          <div className="overflow-hidden">
            <span className="text-xs font-mono font-bold text-white block">Developer Coder</span>
            <span className="text-[9px] font-mono text-slate-500 block truncate">{coderModel}</span>
            {stages.coder.tokensPerSec !== undefined && stages.coder.tokensPerSec > 0 && (
              <span className="text-[9px] font-mono text-indigo-400 block">{Number(stages.coder.tokensPerSec).toFixed(1)} tokens/s</span>
            )}
            {stages.coder.fallback && stages.coder.status === "running" && (
              <span className="text-[8px] font-mono text-amber-500 block truncate" title={stages.coder.fallback}>{stages.coder.fallback}</span>
            )}
          </div>
        </div>

        <ArrowRight className="w-5 h-5 text-slate-700 hidden md:block" />

        {/* Reviewer Node */}
        <div className={`p-3 rounded border flex items-center gap-3 w-48 ${
          stages.reviewer.status === "running" ? "bg-indigo-500/10 border-indigo-500 animate-pulse" :
          stages.reviewer.status === "done" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-[#08090d] border-white/5"
        }`}>
          {getStageIcon(stages.reviewer.status)}
          <div className="overflow-hidden">
            <span className="text-xs font-mono font-bold text-white block">Inspector Reviewer</span>
            <span className="text-[9px] font-mono text-slate-500 block truncate">{reviewerModel}</span>
            {stages.reviewer.tokensPerSec !== undefined && stages.reviewer.tokensPerSec > 0 && (
              <span className="text-[9px] font-mono text-indigo-400 block">{Number(stages.reviewer.tokensPerSec).toFixed(1)} tokens/s</span>
            )}
            {stages.reviewer.fallback && stages.reviewer.status === "running" && (
              <span className="text-[8px] font-mono text-amber-500 block truncate" title={stages.reviewer.fallback}>{stages.reviewer.fallback}</span>
            )}
          </div>
        </div>
      </div>

      {stages.self_improve.status !== "pending" && (
        <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded mb-6 flex items-center gap-3 text-xs text-amber-300">
          <RotateCw className="w-4 h-4 animate-spin text-amber-500/80" />
          <span>{stages.self_improve.text}</span>
        </div>
      )}

      {writeCount !== null && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded mb-5 flex items-center gap-3 text-xs text-emerald-400 font-mono">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>
            <strong>Write Lock Released:</strong> Successfully wrote {writeCount} files recursively into your workspace root.
          </span>
        </div>
      )}

      {/* Output Stream Areas */}
      <div className="space-y-4">
        {stages.architect.text && (
          <div>
            <span className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Architect Outputs ({stages.architect.elapsed ? (stages.architect.elapsed / 1000).toFixed(1) : ""} s)</span>
            <pre className="p-3 bg-black/55 rounded text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-40 border border-white/5">
              {stages.architect.text}
            </pre>
          </div>
        )}

        {stages.coder.text && (
          <div>
            <span className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Coder Outputs ({stages.coder.elapsed ? (stages.coder.elapsed / 1000).toFixed(1) : ""} s)</span>
            <pre className="p-3 bg-black/55 rounded text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-52 border border-white/5">
              {stages.coder.text}
            </pre>
          </div>
        )}

        {stages.reviewer.text && (
          <div>
            <span className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Reviewer Critique ({stages.reviewer.elapsed ? (stages.reviewer.elapsed / 1000).toFixed(1) : ""} s)</span>
            <pre className="p-3 bg-black/55 rounded text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-40 border border-white/5">
              {stages.reviewer.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
