import React, { useEffect, useState } from "react";
import { Play, ToggleLeft, ToggleRight, Sparkles, AlertCircle, CheckCircle2, RotateCw, Loader2, ArrowRight } from "lucide-react";
import { api } from "../lib/apiClient";
import { firstUsableModel } from "../lib/localModel";

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
    { id: "gemini-cli", label: "Gemini CLI" },
    { id: "openrouter", label: "OpenRouter.ai" },
    { id: "openai", label: "OpenAI GPT" },
    { id: "anthropic", label: "Anthropic Claude" },
    { id: "vllm", label: "vLLM (Local)" },
    { id: "llamacpp", label: "llama.cpp (Local)" },
    { id: "demo", label: "Sandbox Simulated" },
  ];

  // Dynamic model loader
  const fetchModels = async (prov: string) => {
    if (modelsList[prov]) return;
    try {
      const list: any = await api.get(`/api/models/${prov}`);
      setModelsList((prev) => ({ ...prev, [prov]: list }));
      if (list.length > 0) {
        const pick = firstUsableModel(list); // skip keyless-cloud placeholders
        if (prov === architectProv) setArchitectModel(pick);
        if (prov === coderProv) setCoderModel(pick);
        if (prov === reviewerProv) setReviewerModel(pick);
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
      let droppedFrames = 0; // count malformed SSE frames instead of silently discarding them

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
                  // Surface any write failures the server collected instead of silently under-counting.
                  if (Array.isArray(data.writeErrors) && data.writeErrors.length > 0) {
                    onNotify(`${data.writeErrors.length} file(s) failed to write: ${data.writeErrors[0]}`, "error");
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
              } catch {
                droppedFrames += 1; // malformed frame — surfaced after the stream, never silently hidden
              }
            }
          },
        },
      );
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        if (droppedFrames > 0) onNotify(`Pipeline: ${droppedFrames} malformed frame(s) skipped`, "info");
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
        return <Loader2 className="w-5 h-5 text-status-accent animate-spin" />;
      case "done":
        return <CheckCircle2 className="w-5 h-5 text-status-ok" />;
      case "fail":
        return <AlertCircle className="w-5 h-5 text-status-err" />;
      case "pending":
      default:
        return <div className="w-5 h-5 rounded-full border border-immersive-border bg-immersive-bg"></div>;
    }
  };

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-status-accent" />
          <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Multi-Agent Development Pipeline</h2>
        </div>
      </div>

      {/* Input Prompter */}
      <div className="mb-5">
        <label htmlFor="pipeline-prompt" className="text-[10px] text-immersive-text-dim font-mono tracking-widest block mb-1.5 uppercase">Prompt Requirements</label>
        <textarea
          id="pipeline-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="E.g. Create a FastAPI microservice returning a random quote list, containing custom health checkpoints and Pytest coverages..."
          className="w-full bg-immersive-inset border border-immersive-border rounded p-3 text-xs text-immersive-text-bright placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono resize-none transition-colors"
        />
      </div>

      {/* Controls & Configuration Block */}
      <h3 className="text-[10px] text-immersive-text-dim font-mono tracking-widest block uppercase mb-2">Agent Assignments</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* Architect Role */}
        <div className="bg-immersive-inset border border-immersive-border p-3.5 rounded flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">1. Systems Architect</span>
            <span className="text-[9px] text-immersive-text-dim block mb-2.5">Layout structures, directories mapper</span>
          </div>
          <div className="space-y-1.5">
            <select
              value={architectProv}
              onChange={(e) => setArchitectProv(e.target.value)}
              className="w-full bg-immersive-bg border border-immersive-border text-[10px] rounded px-1.5 py-1 text-immersive-text-muted focus:outline-none font-mono"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={architectModel}
              onChange={(e) => setArchitectModel(e.target.value)}
              className="w-full bg-immersive-bg border border-immersive-border text-[10px] rounded px-1.5 py-1 text-immersive-text-muted focus:outline-none font-mono"
            >
              {(modelsList[architectProv] || ["Loading..."]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Coder Role */}
        <div className="bg-immersive-inset border border-immersive-border p-3.5 rounded flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">2. Developer Coder</span>
            <span className="text-[9px] text-immersive-text-dim block mb-2.5">Writes full executable code blocks</span>
          </div>
          <div className="space-y-1.5">
            <select
              value={coderProv}
              onChange={(e) => setCoderProv(e.target.value)}
              className="w-full bg-immersive-bg border border-immersive-border text-[10px] rounded px-1.5 py-1 text-immersive-text-muted focus:outline-none font-mono"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={coderModel}
              onChange={(e) => setCoderModel(e.target.value)}
              className="w-full bg-immersive-bg border border-immersive-border text-[10px] rounded px-1.5 py-1 text-immersive-text-muted focus:outline-none font-mono"
            >
              {(modelsList[coderProv] || ["Loading..."]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reviewer Role */}
        <div className="bg-immersive-inset border border-immersive-border p-3.5 rounded flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">3. Inspector Reviewer</span>
            <span className="text-[9px] text-immersive-text-dim block mb-2.5">Algorithmic inspection, security audit</span>
          </div>
          <div className="space-y-1.5">
            <select
              value={reviewerProv}
              onChange={(e) => setReviewerProv(e.target.value)}
              className="w-full bg-immersive-bg border border-immersive-border text-[10px] rounded px-1.5 py-1 text-immersive-text-muted focus:outline-none font-mono"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={reviewerModel}
              onChange={(e) => setReviewerModel(e.target.value)}
              className="w-full bg-immersive-bg border border-immersive-border text-[10px] rounded px-1.5 py-1 text-immersive-text-muted focus:outline-none font-mono"
            >
              {(modelsList[reviewerProv] || ["Loading..."]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Advanced pipeline parameters toggles */}
      <div className="bg-immersive-inset border border-immersive-border p-3 rounded mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Write files */}
        <div className="flex items-center justify-between">
          <div className="text-left">
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">Auto-Write Workspace Files</span>
            <span className="text-[10px] text-immersive-text-dim block">Directly write parsed FILE structures to disk</span>
          </div>
          <button onClick={() => setWriteFiles(!writeFiles)}>
            {writeFiles ? (
              <ToggleRight className="w-8 h-8 text-status-accent cursor-pointer" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-immersive-text-dim cursor-pointer" />
            )}
          </button>
        </div>

        {/* Self Improve */}
        <div className="flex items-center justify-between">
          <div className="text-left">
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">Bounded Self-Improve Loop</span>
            <span className="text-[10px] text-immersive-text-dim block">Iterate debugger cycle when Pytest asserts fail</span>
          </div>
          <div className="flex items-center gap-1.5">
            {enableSelfImprove && (
              <input
                type="number"
                min={1}
                max={3}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
                className="w-10 bg-immersive-bg border border-immersive-border-strong text-[10px] font-mono px-1 py-0.5 rounded text-immersive-text-bright"
              />
            )}
            <button onClick={() => setEnableSelfImprove(!enableSelfImprove)}>
              {enableSelfImprove ? (
                <ToggleRight className="w-8 h-8 text-status-accent cursor-pointer" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-immersive-text-dim cursor-pointer" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="text-[10px] text-immersive-text-dim font-mono italic">
          Target Workspace: <span className="text-immersive-text-muted">{workspacePath}</span>
        </div>
        <div className="flex gap-2">
          {running && (
            <button
              onClick={handleStop}
              className="bg-rose-500/10 hover:bg-rose-500/20 text-status-err border border-rose-500/20 font-mono font-bold text-xs px-5 py-2 rounded transition cursor-pointer"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            className="bg-indigo-500/10 hover:bg-indigo-500/20 text-status-accent border border-indigo-500/20 font-mono font-bold text-xs px-5 py-2 rounded disabled:opacity-50 flex items-center gap-2 cursor-pointer transition"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Execute Pipeline
          </button>
        </div>
      </div>

      {/* DAG GRAPH GRAPHICS */}
      <h3 className="text-[10px] text-immersive-text-dim font-mono tracking-widest block uppercase mb-3">Pipeline Execution DAG (Directed Acyclic Graph)</h3>
      <div className="flex flex-col md:flex-row items-center justify-around gap-4 p-5 bg-immersive-inset border border-immersive-border rounded mb-6">
        {/* Architect Node */}
        <div className={`p-3 rounded border flex items-center gap-3 w-48 ${
          stages.architect.status === "running" ? "bg-indigo-500/10 border-indigo-500 animate-pulse" :
          stages.architect.status === "done" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-immersive-sidebar border-immersive-border"
        }`}>
          {getStageIcon(stages.architect.status)}
          <div className="overflow-hidden">
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">Architect</span>
            <span className="text-[9px] font-mono text-immersive-text-dim block truncate">{architectModel}</span>
            {stages.architect.tokensPerSec !== undefined && stages.architect.tokensPerSec > 0 && (
              <span className="text-[9px] font-mono text-status-accent block">{Number(stages.architect.tokensPerSec).toFixed(1)} tokens/s</span>
            )}
            {stages.architect.fallback && stages.architect.status === "running" && (
              <span className="text-[8px] font-mono text-status-warn block truncate" title={stages.architect.fallback}>{stages.architect.fallback}</span>
            )}
          </div>
        </div>

        <ArrowRight className="w-5 h-5 text-immersive-text-dim hidden md:block" />

        {/* Coder Node */}
        <div className={`p-3 rounded border flex items-center gap-3 w-48 ${
          stages.coder.status === "running" ? "bg-indigo-500/10 border-indigo-500 animate-pulse" :
          stages.coder.status === "done" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-immersive-sidebar border-immersive-border"
        }`}>
          {getStageIcon(stages.coder.status)}
          <div className="overflow-hidden">
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">Developer Coder</span>
            <span className="text-[9px] font-mono text-immersive-text-dim block truncate">{coderModel}</span>
            {stages.coder.tokensPerSec !== undefined && stages.coder.tokensPerSec > 0 && (
              <span className="text-[9px] font-mono text-status-accent block">{Number(stages.coder.tokensPerSec).toFixed(1)} tokens/s</span>
            )}
            {stages.coder.fallback && stages.coder.status === "running" && (
              <span className="text-[8px] font-mono text-status-warn block truncate" title={stages.coder.fallback}>{stages.coder.fallback}</span>
            )}
          </div>
        </div>

        <ArrowRight className="w-5 h-5 text-immersive-text-dim hidden md:block" />

        {/* Reviewer Node */}
        <div className={`p-3 rounded border flex items-center gap-3 w-48 ${
          stages.reviewer.status === "running" ? "bg-indigo-500/10 border-indigo-500 animate-pulse" :
          stages.reviewer.status === "done" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-immersive-sidebar border-immersive-border"
        }`}>
          {getStageIcon(stages.reviewer.status)}
          <div className="overflow-hidden">
            <span className="text-xs font-mono font-bold text-immersive-text-bright block">Inspector Reviewer</span>
            <span className="text-[9px] font-mono text-immersive-text-dim block truncate">{reviewerModel}</span>
            {stages.reviewer.tokensPerSec !== undefined && stages.reviewer.tokensPerSec > 0 && (
              <span className="text-[9px] font-mono text-status-accent block">{Number(stages.reviewer.tokensPerSec).toFixed(1)} tokens/s</span>
            )}
            {stages.reviewer.fallback && stages.reviewer.status === "running" && (
              <span className="text-[8px] font-mono text-status-warn block truncate" title={stages.reviewer.fallback}>{stages.reviewer.fallback}</span>
            )}
          </div>
        </div>
      </div>

      {stages.self_improve.status !== "pending" && (
        <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded mb-6 flex items-center gap-3 text-xs text-status-warn">
          <RotateCw className="w-4 h-4 animate-spin text-status-warn" />
          <span>{stages.self_improve.text}</span>
        </div>
      )}

      {writeCount !== null && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded mb-5 flex items-center gap-3 text-xs text-status-ok font-mono">
          <CheckCircle2 className="w-4 h-4 text-status-ok" />
          <span>
            <strong>Write Lock Released:</strong> Successfully wrote {writeCount} files recursively into your workspace root.
          </span>
        </div>
      )}

      {/* Output Stream Areas */}
      <div className="space-y-4">
        {stages.architect.text && (
          <div>
            <span className="text-[10px] text-immersive-text-dim font-mono uppercase block mb-1">Architect Outputs ({stages.architect.elapsed ? (stages.architect.elapsed / 1000).toFixed(1) : ""} s)</span>
            <pre className="p-3 bg-immersive-inset rounded text-xs font-mono text-immersive-text-muted overflow-x-auto whitespace-pre-wrap max-h-40 border border-immersive-border">
              {stages.architect.text}
            </pre>
          </div>
        )}

        {stages.coder.text && (
          <div>
            <span className="text-[10px] text-immersive-text-dim font-mono uppercase block mb-1">Coder Outputs ({stages.coder.elapsed ? (stages.coder.elapsed / 1000).toFixed(1) : ""} s)</span>
            <pre className="p-3 bg-immersive-inset rounded text-xs font-mono text-immersive-text-muted overflow-x-auto whitespace-pre-wrap max-h-52 border border-immersive-border">
              {stages.coder.text}
            </pre>
          </div>
        )}

        {stages.reviewer.text && (
          <div>
            <span className="text-[10px] text-immersive-text-dim font-mono uppercase block mb-1">Reviewer Critique ({stages.reviewer.elapsed ? (stages.reviewer.elapsed / 1000).toFixed(1) : ""} s)</span>
            <pre className="p-3 bg-immersive-inset rounded text-xs font-mono text-immersive-text-muted overflow-x-auto whitespace-pre-wrap max-h-40 border border-immersive-border">
              {stages.reviewer.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
