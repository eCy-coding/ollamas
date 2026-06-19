import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, Play, ToggleLeft, ToggleRight, Check, X, 
  Terminal, ShieldCheck, History, RefreshCw, AlertCircle, 
  FileText, FolderGit, Search, Hammer, Braces, ArrowRight, CornerDownLeft
} from "lucide-react";
import { ChatSession } from "../types";
import { api, ApiError } from "../lib/apiClient";

interface TraceStep {
  stepNum: number;
  tool: string;
  args: any;
  ok: boolean;
  latency: number;
  result: any;
  diff?: string;
  applied?: boolean;
}

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

interface ReactAgentTabProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

export function ReactAgentTab({ onNotify }: ReactAgentTabProps) {
  const [provider, setProvider] = useState<string>("gemini");
  const [model, setModel] = useState<string>("gemini-3.5-flash");
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);

  const [inputMessage, setInputMessage] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I am your ReAct specialist agent. I have high-fidelity local workspace tool bindings. Describe a software task, and watch me inspect the repository, write the code, and run tests sequentially to execute it safely."
    }
  ]);

  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [autoApply, setAutoApply] = useState<boolean>(true);
  const [currentStepInfo, setCurrentStepInfo] = useState<string>("");

  // ReAct Sessions Memory States
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(false);

  // vF8 — abort the in-flight agent stream on unmount / new run, and guard state
  // updates after unmount (the stream out-lives the component otherwise).
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; abortRef.current?.abort(); }, []);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const data: any = await api.get("/api/agent/sessions");
      setSessions(data);
      return data;
    } catch (e) {
      // non-ok previously returned [] silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify("Failed to fetch past sessions config list.", "error");
      }
    } finally {
      setLoadingSessions(false);
    }
    return [];
  };

  const selectSession = async (id: string) => {
    setIsLoading(true);
    try {
      const data: any = await api.get(`/api/agent/sessions/${id}`);
      setActiveSessionId(data.id);
      setProvider(data.providerId || "gemini");
      setModel(data.modelId || "gemini-3.5-flash");
      setMessages(data.messages.length > 0 ? data.messages : [
        {
          role: "assistant",
          content: "Welcome back! How can I help you proceed with this ReAct session?"
        }
      ]);
      setTraceSteps([]);
      setPendingApproval(null);
    } catch (e) {
      if (e instanceof ApiError) {
        onNotify("Failed to load chosen agent session context.", "error");
      } else {
        onNotify("Error restoring active session state.", "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const startNewSession = async () => {
    setIsLoading(true);
    try {
      const newSess: any = await api.post("/api/agent/sessions", {
        title: "New ReAct Session",
        providerId: provider,
        modelId: model
      });
      setActiveSessionId(newSess.id);
      setMessages([
        {
          role: "assistant",
          content: "Session initialized successfully. Provide a software goal, and we can inspect local code files, make edits, and verify changes."
        }
      ]);
      setTraceSteps([]);
      setPendingApproval(null);
      await loadSessions();
    } catch (e) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify("Could not create persistent agent session.", "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this conversation session?")) return;
    try {
      await api.del(`/api/agent/sessions/${id}`);
      onNotify("Session deleted.", "success");
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([
          {
            role: "assistant",
            content: "Hello! I am your ReAct specialist agent. I have high-fidelity local workspace tool bindings. Describe a software task, and watch me inspect the repository, write the code, and run tests sequentially to execute it safely."
          }
        ]);
        setTraceSteps([]);
        setPendingApproval(null);
      }
      await loadSessions();
    } catch (e) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify("Failed to delete the chosen session.", "error");
      }
    }
  };

  // Pending write approval state (for when autoApply is OFF)
  const [pendingApproval, setPendingApproval] = useState<{
    path: string;
    content: string;
    diff: string;
    stepIndex: number;
  } | null>(null);

  const [approving, setApproving] = useState<boolean>(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const providers = [
    { id: "gemini", label: "Google Gemini Core", icon: "🌌" },
    { id: "openai", label: "OpenAI gpt-series", icon: "🟢" },
    { id: "anthropic", label: "Anthropic Claude", icon: "🎨" },
    { id: "openrouter", label: "OpenRouter Hub", icon: "🛰️" },
    { id: "ollama-local", label: "Ollama (Local Engine)", icon: "🏠" },
    { id: "ollama-cloud", label: "Ollama Cloud Infrastructure", icon: "🌩️" }
  ];

  // Fetch real models whenever provider changes
  const fetchModels = async (prov: string) => {
    setLoadingModels(true);
    try {
      const list: any = await api.get(`/api/models/${prov}`);
      setModelsList(list);
      if (list.length > 0) {
        // Filter out error placeholder elements for initial selection
        const validModel = list.find((m: string) => !m.includes("not set") && !m.includes("API key"));
        setModel(validModel || list[0]);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setModelsList([]);
      } else {
        onNotify("Failed to fetch live model list. Using static presets.", "error");
        setModelsList(["gemini-3.5-flash", "gemini-3.1-pro-preview"]);
      }
    } finally {
      setLoadingModels(false);
    }
  };

  // Load initial sessions and fetch model lists on mount
  const hasLoadedInit = useRef<boolean>(false);
  useEffect(() => {
    const init = async () => {
      await fetchModels(provider);
      const loaded = await loadSessions();
      if (loaded && loaded.length > 0) {
        await selectSession(loaded[0].id);
      }
      hasLoadedInit.current = true;
    };
    init();
  }, []);

  // Sync models list only when provider changes, ignoring double activation on mount
  useEffect(() => {
    if (!hasLoadedInit.current) return;
    fetchModels(provider);
  }, [provider]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle standard ReAct agent submit
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    const userText = inputMessage.trim();
    setInputMessage("");
    setPendingApproval(null);

    setIsLoading(true);
    setTraceSteps([]);
    setCurrentStepInfo("Spinning up local ReAct engine context...");

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      try {
        const newSess: any = await api.post("/api/agent/sessions", {
          title: userText.slice(0, 45) + (userText.length > 45 ? "..." : ""),
          providerId: provider,
          modelId: model
        });
        currentSessionId = newSess.id;
        setActiveSessionId(newSess.id);
      } catch (err) {
        // non-ok previously fell through silently; only log non-ApiError (network) failures
        if (!(err instanceof ApiError)) {
          console.error("Auto session generation failed", err);
        }
      }
    }

    const newMessages = [...messages, { role: "user", content: userText } as any];
    setMessages(newMessages);

    // Cancel any prior run, start a fresh abortable one.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let chunkBuffer = "";

      await api.streamPost(
        "/api/agent/chat",
        {
          provider,
          model,
          messages: newMessages,
          autoApply,
          maxSteps: 10,
          sessionId: currentSessionId
        },
        {
          signal: ctrl.signal,
          onChunk: (chunk) => {
            chunkBuffer += chunk;
            const lines = chunkBuffer.split("\n\n");
            // Keep the last partial line if not completed
            chunkBuffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim() || !line.startsWith("data: ")) continue;
              try {
                const parsed = JSON.parse(line.substring(6));

                if (parsed.type === "thought") {
                  setCurrentStepInfo(parsed.text);
                }
                else if (parsed.type === "message") {
                  setMessages((prev) => {
                    // If the last message is already assistant, append or replace
                    const last = prev[prev.length - 1];
                    if (last && last.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: parsed.text }];
                    }
                    return [...prev, { role: "assistant", content: parsed.text }];
                  });
                }
                else if (parsed.type === "step") {
                  setTraceSteps((prev) => {
                    // De-duplicate trace steps by stepNum and tool
                    if (prev.some(s => s.stepNum === parsed.stepNum && s.tool === parsed.tool)) {
                      return prev;
                    }
                    return [...prev, {
                      stepNum: parsed.stepNum,
                      tool: parsed.tool,
                      args: parsed.args,
                      ok: parsed.ok,
                      latency: parsed.latency,
                      result: parsed.result,
                      diff: parsed.diff,
                      applied: parsed.applied
                    }];
                  });

                  // If a write tool is called with auto-apply turned OFF, lock the visual approval wizard
                  if (parsed.tool === "write_file" && !parsed.applied && parsed.diff) {
                    setPendingApproval({
                      path: parsed.args.path,
                      content: parsed.args.content,
                      diff: parsed.diff,
                      stepIndex: parsed.stepNum
                    });
                    onNotify("Write operation halted - awaiting manual approval.", "info");
                  }
                }
                else if (parsed.type === "paused") {
                  setCurrentStepInfo("Paused. Manual file authorization requested.");
                }
                else if (parsed.type === "done") {
                  setCurrentStepInfo("Reasoning loop successfully finalized.");
                }
                else if (parsed.type === "error") {
                  onNotify(`Agent Reasoner: ${parsed.message}`, "error");
                  setCurrentStepInfo("Error context occurred.");
                }
              } catch (e) {
                console.warn("Could not parse SSE message", e);
              }
            }
          },
        },
      );
    } catch (err: any) {
      // Aborts (unmount / new run) are intentional — don't surface them as errors.
      if (ctrl.signal.aborted) return;
      onNotify(`Agent runtime failed: ${err.message}`, "error");
      setCurrentStepInfo("Agent pipeline disrupted.");
    } finally {
      if (mountedRef.current && !ctrl.signal.aborted) {
        setIsLoading(false);
        loadSessions();
      }
    }
  };

  const approveWrite = async () => {
    if (!pendingApproval) return;
    setApproving(true);
    try {
      await api.post("/api/agent/approve-write", {
        path: pendingApproval.path,
        content: pendingApproval.content
      });

      onNotify(`Successfully applied file updates to ${pendingApproval.path}`, "success");
      // Update trace status in the list
      setTraceSteps((prev) =>
        prev.map((s) => s.stepNum === pendingApproval.stepIndex && s.tool === "write_file"
          ? { ...s, applied: true, result: "File successfully written following manual validation." }
          : s
        )
      );
      setPendingApproval(null);

      // Let assistant know user approved
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Approved write for: \`${pendingApproval.path}\`. Proving files update sequence completed.` }
      ]);
    } catch (err: any) {
      // non-ok responses previously parsed the JSON body for an error message
      const msg = err instanceof ApiError
        ? ((err.body as any)?.error || "Failed write command.")
        : err.message;
      onNotify(`Rejected approval write: ${msg}`, "error");
    } finally {
      setApproving(false);
    }
  };

  const cancelWrite = () => {
    if (!pendingApproval) return;
    onNotify("Write operation rejected. Changes were deleted from the queue.", "info");
    setTraceSteps((prev) => 
      prev.map((s) => s.stepNum === pendingApproval.stepIndex && s.tool === "write_file" 
        ? { ...s, result: "File update cancelled by system administrator." }
        : s
      )
    );
    setPendingApproval(null);
  };

  return (
    <div className="space-y-6">
      
      {/* Upper Model Control Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#08090d] border border-white/5 rounded-lg p-4">
        
        {/* Provider Choice */}
        <div className="space-y-1.5Col">
          <label htmlFor="react-agent-provider" className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold">Select Agent Provider</label>
          <div className="relative">
            <select
              id="react-agent-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic Model Dropdown */}
        <div className="space-y-1.5">
          <label htmlFor="react-agent-model" className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold">Active LLM Model</label>
          <div className="relative">
            <select
              id="react-agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={loadingModels || modelsList.length === 0}
              className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50 disabled:opacity-50"
            >
              {loadingModels ? (
                <option>Loading live models from provider...</option>
              ) : modelsList.length === 0 ? (
                <option>No models available. Check credential key vault.</option>
              ) : (
                modelsList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Toggles & Actions */}
        <div className="flex flex-col justify-end space-y-1">
          <div className="flex items-center justify-between border border-white/5 bg-slate-900/40 rounded p-1 px-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px] font-mono text-slate-400">Auto-Apply Writes</span>
            </div>
            <button 
              onClick={() => {
                setAutoApply(!autoApply);
                onNotify(autoApply ? "Auto-apply writes disabled. Changes will require manual approval." : "Auto-apply enabled. Writes will execute instantly.", "info");
              }}
              className="text-slate-400 hover:text-white transition"
              title="When enabled, file updates are instantly written to the workspace. When disabled, the agent displays file diffs and awaits manual authorization."
            >
              {autoApply ? (
                <ToggleRight className="w-8 h-8 text-indigo-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-slate-600" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace Frame */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

        {/* Sessions Sidebar Column picker (M6 / AC-A6) */}
        <div className="bg-[#08090d] border border-white/5 rounded-lg p-4 flex flex-col justify-start space-y-3 xl:col-span-1 h-[470px]">
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-slate-400">ReAct Sessions</span>
            </div>
            <button
              onClick={startNewSession}
              disabled={isLoading}
              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono text-[9px] rounded px-2 py-0.5 transition select-none"
            >
              + NEW
            </button>
          </div>

          <div className="space-y-1.5 flex-1 overflow-y-auto scrollbar-thin pr-1">
            {loadingSessions && sessions.length === 0 ? (
              <div className="text-[10px] font-mono text-slate-500 text-center py-4">Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="text-[10px] font-mono text-slate-500 text-center py-4">No active sessions located. Click "+ NEW" to begin.</div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                const formattedDate = new Date(sess.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div
                    key={sess.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isLoading && selectSession(sess.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!isLoading) selectSession(sess.id);
                      }
                    }}
                    className={`group w-full text-left p-2 rounded cursor-pointer transition flex items-center justify-between border ${
                      isActive 
                        ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
                        : "bg-slate-900/30 border-white/5 hover:bg-slate-900/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-1 truncate">
                      <span className="text-xs font-mono font-medium truncate leading-tight group-hover:text-slate-100">{sess.title}</span>
                      <span className="text-[9px] text-slate-600 font-mono mt-0.5">{formattedDate} • {sess.modelId.split("/").pop()}</span>
                    </div>
                    <button
                      onClick={(e) => deleteSession(e, sess.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition shrink-0"
                      title="Delete Session"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        
        {/* Right Hand: Chat and Tools area wrapper */}
        <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Hand: High Fidelity Chats */}
          <div className="lg:col-span-2 space-y-4 flex flex-col min-h-[500px]">
            
            {/* Chat Bubble Console */}
            <div className="flex-1 bg-[#08090d] border border-white/5 rounded-lg p-4 h-[400px] overflow-y-auto space-y-4 scrollbar-thin">
              {messages.filter(m => m.role === "user" || m.role === "assistant").map((m, idx) => (
              <div 
                key={idx}
                className={`flex gap-3 max-w-[85%] ${
                  m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                }`}
              >
                {/* Avatar Icon */}
                <div className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold shrink-0 ${
                  m.role === "user" 
                    ? "bg-indigo-500 text-white" 
                    : "bg-slate-800 text-purple-300 border border-purple-500/20"
                }`}>
                  {m.role === "user" ? "U" : "A"}
                </div>

                {/* Content Bubble */}
                <div className={`p-3 rounded-lg text-xs leading-relaxed ${
                  m.role === "user" 
                    ? "bg-indigo-600 text-slate-100 font-medium" 
                    : "bg-[#0b0c10] border border-white/5 text-slate-300 font-mono whitespace-pre-wrap"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            
            {/* Typing status bar */}
            {isLoading && (
              <div className="flex items-center gap-3 mr-auto">
                <div className="w-7 h-7 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs text-indigo-400 animate-pulse">
                  R
                </div>
                <div className="px-3.5 py-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/10 text-xs font-mono text-slate-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  <span>{currentStepInfo || "Reasoning step execution..."}</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Interactive Chat Form */}
          <form onSubmit={handleSendMessage} className="flex gap-2.5">
            <input 
              type="text" 
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Inject a prompt to trigger the ReAct Specialist agent (e.g. 'Read readme.md and list bugs')..."
              disabled={isLoading}
              className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20"
            />
            <button 
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white shrink-0 px-5 rounded-lg flex items-center justify-center gap-2 transition text-xs font-bold"
            >
              <CornerDownLeft className="w-4 h-4" />
              <span>EXECUTE</span>
            </button>
          </form>
        </div>

        {/* Right Hand: Interactive Tool Status and Verification panels */}
        <div className="space-y-4">
          
          {/* List of core Tools */}
          <div className="bg-[#08090d] border border-white/5 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <Hammer className="w-4 h-4 text-indigo-400" />
              <h3 className="text-[10px] font-mono tracking-wider font-bold uppercase text-slate-300">WORKSPACE TOOL BINDINGS</h3>
            </div>
            
            <div className="grid grid-cols-1 gap-2.5">
              <div className="flex items-start gap-2.5 p-2 bg-slate-950 rounded border border-white/5">
                <FolderGit className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-slate-300">list_tree</h4>
                  <p className="text-[9px] text-slate-500 font-mono">Iterate the entire project space files layout recursively.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-slate-950 rounded border border-white/5">
                <FileText className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-slate-300">read_file</h4>
                  <p className="text-[9px] text-slate-500 font-mono">Load absolute context and code content parameters synchronously.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-slate-950 rounded border border-white/5">
                <Braces className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-slate-300">write_file</h4>
                  <p className="text-[9px] text-slate-500 font-mono">Apply secure developer code updates with native validation diff safety.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-slate-950 rounded border border-white/5">
                <Terminal className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-slate-300">run_command</h4>
                  <p className="text-[9px] text-slate-500 font-mono">Execute testing allowlist commands (pytest, cargo, npm, ruff, black).</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-slate-950 rounded border border-white/5">
                <Search className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-slate-300">grep_search</h4>
                  <p className="text-[9px] text-slate-500 font-mono">Execute recursive keyword search queries across text layers.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Approvals Widget */}
          {pendingApproval && (
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">AUTHORIZATION REQUIRED</h4>
              </div>
              <p className="text-[11px] font-mono text-slate-300 leading-relaxed">
                The agent proposes updates to: <code className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-white text-[10px]">{pendingApproval.path}</code>
              </p>

              {/* Diff Viewer Card */}
              <div className="bg-[#050608] border border-white/5 rounded p-2.5 max-h-48 overflow-y-auto font-mono text-[9px] text-slate-400 whitespace-pre scrollbar-thin">
                {pendingApproval.diff}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={approveWrite}
                  disabled={approving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white py-2 rounded text-[10px] font-bold font-mono transition flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{approving ? "WRITE..." : "APPROVE WRITE"}</span>
                </button>
                <button
                  onClick={cancelWrite}
                  disabled={approving}
                  className="flex-1 bg-rose-950/40 hover:bg-rose-950 border border-rose-500/20 text-rose-300 py-2 rounded text-[10px] font-bold font-mono transition"
                >
                  REJECT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Real-time Steps Trace execution stream */}
      {traceSteps.length > 0 && (
        <div className="bg-[#08090d] border border-white/5 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-400" />
            <h3 className="text-[11px] font-mono tracking-widest font-bold uppercase text-slate-300">REACT AGENT ACTIONS TRACE ENGINE</h3>
          </div>

          <div className="overflow-x-auto border border-white/5 rounded-md">
            <table className="w-full text-left font-mono text-slate-300 border-collapse">
              <thead>
                <tr className="bg-slate-900/50 border-b border-white/5 text-[10px] uppercase text-slate-400 text-left">
                  <th className="px-4 py-3 font-semibold">Step</th>
                  <th className="px-4 py-3 font-semibold">Activated Tool</th>
                  <th className="px-4 py-3 font-semibold">Passed Arguments</th>
                  <th className="px-4 py-3 font-semibold">Latency</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Result Log</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {traceSteps.map((s, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.01] transition duration-200">
                    <td className="px-4 py-3 text-indigo-400 font-bold whitespace-nowrap">STEP {s.stepNum}</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap text-purple-300 flex items-center gap-1.5 mt-0.5">
                      <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>{s.tool}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-pre">
                      {JSON.stringify(s.args)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{s.latency} ms</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.ok ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          SUCCESS
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 border border-rose-500/20 text-rose-400">
                          FAILED
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-sm truncate whitespace-pre text-[10px] text-slate-400" title={typeof s.result === "string" ? s.result : JSON.stringify(s.result)}>
                      {typeof s.result === "string" ? s.result : JSON.stringify(s.result)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
