import React, { useState, useEffect, useRef } from "react";
import { useLingui } from "@lingui/react";
import {
  ToggleLeft, ToggleRight, Check, X,
  Terminal, ShieldCheck, History, AlertCircle,
  FileText, FolderGit, Search, Hammer, Braces, ArrowRight, CornerDownLeft, Copy
} from "lucide-react";
import { ChatSession } from "../types";
import { api, ApiError } from "../lib/apiClient";
import { AgentMessage } from "./AgentMessage";

interface TraceStep {
  stepNum: number;
  tool: string;
  args: unknown;
  ok: boolean;
  latency: number;
  result: unknown;
  diff?: string;
  applied?: boolean;
}

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  // The agent step that produced this assistant message. Server emits one `message`
  // per step (full per-step text, not a delta) → key by step so a later step APPENDS a
  // new message instead of overwriting an earlier step's text.
  step?: number;
}

interface ReactAgentTabProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

export function ReactAgentTab({ onNotify }: ReactAgentTabProps) {
  const { _ } = useLingui();
  const [provider, setProvider] = useState<string>("gemini");
  const [model, setModel] = useState<string>("gemini-3.5-flash");
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);

  const [inputMessage, setInputMessage] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      role: "assistant",
      content: _("react-agent.greeting.welcome")
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
  // Synchronous in-flight guard: the `isLoading` STATE flag has a one-tick race (two
  // submits in the same tick both read isLoading=false). A ref flips immediately.
  const runningRef = useRef(false);
  useEffect(() => () => { mountedRef.current = false; abortRef.current?.abort(); }, []);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const data = await api.get<ChatSession[]>("/api/agent/sessions");
      setSessions(data);
      return data;
    } catch (e) {
      // non-ok previously returned [] silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify(_("react-agent.notify.fetchSessionsFailed"), "error");
      }
    } finally {
      setLoadingSessions(false);
    }
    return [];
  };

  const selectSession = async (id: string) => {
    setIsLoading(true);
    try {
      const data = await api.get<ChatSession>(`/api/agent/sessions/${id}`);
      setActiveSessionId(data.id);
      setProvider(data.providerId || "gemini");
      setModel(data.modelId || "gemini-3.5-flash");
      const restored: Message[] = (data.messages || []).map((m) => ({ role: m.role as Message["role"], content: m.content }));
      setMessages(restored.length > 0 ? restored : [
        {
          role: "assistant",
          content: _("react-agent.greeting.back")
        }
      ]);
      setTraceSteps([]);
      setPendingApproval(null);
    } catch (e) {
      if (e instanceof ApiError) {
        onNotify(_("react-agent.notify.loadSessionFailed"), "error");
      } else {
        onNotify(_("react-agent.notify.restoreSessionError"), "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const startNewSession = async () => {
    setIsLoading(true);
    try {
      const newSess = await api.post<ChatSession>("/api/agent/sessions", {
        title: _("react-agent.session.defaultTitle"),
        providerId: provider,
        modelId: model
      });
      setActiveSessionId(newSess.id);
      setMessages([
        {
          role: "assistant",
          content: _("react-agent.greeting.initialized")
        }
      ]);
      setTraceSteps([]);
      setPendingApproval(null);
      await loadSessions();
    } catch (e) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify(_("react-agent.notify.createSessionFailed"), "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm(_("react-agent.confirm.delete"))) return;
    try {
      await api.del(`/api/agent/sessions/${id}`);
      onNotify(_("react-agent.notify.sessionDeleted"), "success");
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([
          {
            role: "assistant",
            content: _("react-agent.greeting.welcome")
          }
        ]);
        setTraceSteps([]);
        setPendingApproval(null);
      }
      await loadSessions();
    } catch (e) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify(_("react-agent.notify.deleteSessionFailed"), "error");
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

  // Which trace row is expanded to show full args/result/diff (null = none).
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const traceEndRef = useRef<HTMLDivElement>(null);

  // Copy to clipboard (reuses the app-wide pattern) → user feedback via onNotify.
  const copyText = (s: string) => {
    navigator.clipboard?.writeText(s);
    onNotify(_("react-agent.notify.copied"), "info");
  };

  // Abort an in-flight run from the UI. The stream's catch/finally already treat an
  // abort as intentional (signal.aborted guards) → state stays consistent.
  const stopRun = () => {
    abortRef.current?.abort();
    runningRef.current = false;
    setIsLoading(false);
    setCurrentStepInfo("");
    onNotify(_("react-agent.notify.stopped"), "info");
  };

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
      const list = await api.get<string[]>(`/api/models/${prov}`);
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
        onNotify(_("react-agent.notify.fetchModelsFailed"), "error");
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

  // Keep the streaming trace in view as steps arrive (decoupled from the chat scroll).
  useEffect(() => {
    if (traceSteps.length) traceEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [traceSteps]);

  // Handle standard ReAct agent submit
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || isLoading || runningRef.current) return;
    runningRef.current = true;

    const userText = inputMessage.trim();
    setInputMessage("");
    setPendingApproval(null);

    setIsLoading(true);
    setTraceSteps([]);
    setCurrentStepInfo(_("react-agent.step.spinningUp"));

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      try {
        const newSess = await api.post<ChatSession>("/api/agent/sessions", {
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

    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
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
                    // Replace ONLY a same-step re-emit (idempotent re-render); a message from a
                    // NEW step appends → multi-step assistant output is no longer overwritten.
                    const last = prev[prev.length - 1];
                    if (last && last.role === "assistant" && last.step === parsed.step) {
                      return [...prev.slice(0, -1), { role: "assistant", content: parsed.text, step: parsed.step }];
                    }
                    return [...prev, { role: "assistant", content: parsed.text, step: parsed.step }];
                  });
                }
                else if (parsed.type === "step") {
                  const incoming: TraceStep = {
                    stepNum: parsed.stepNum,
                    tool: parsed.tool,
                    args: parsed.args,
                    ok: parsed.ok,
                    latency: parsed.latency,
                    result: parsed.result,
                    diff: parsed.diff,
                    applied: parsed.applied
                  };
                  setTraceSteps((prev) => {
                    // Upsert by (stepNum, tool): a re-emit (e.g. applied flips true) UPDATES the
                    // existing row instead of being dropped as a dup — otherwise an approved write
                    // would show applied:false forever.
                    const i = prev.findIndex((s) => s.stepNum === incoming.stepNum && s.tool === incoming.tool);
                    if (i === -1) return [...prev, incoming];
                    const next = prev.slice();
                    next[i] = { ...next[i], ...incoming };
                    return next;
                  });

                  // The write applied (auto-apply or approved) → close any lingering approval
                  // wizard for this step so it can't show stale data after the file is written.
                  if (parsed.tool === "write_file" && parsed.applied) {
                    setPendingApproval((p) => (p && p.stepIndex === parsed.stepNum ? null : p));
                  }

                  // If a write tool is called with auto-apply turned OFF, lock the visual approval wizard
                  // Guard parsed.args: a partial/errored trace can omit it; reading
                  // .path on null would throw inside the SSE loop and silently drop
                  // the write (caught as "Could not parse SSE", wizard never opens).
                  if (parsed.tool === "write_file" && !parsed.applied && parsed.diff && parsed.args?.path) {
                    setPendingApproval({
                      path: parsed.args.path,
                      content: parsed.args?.content ?? "",
                      diff: parsed.diff,
                      stepIndex: parsed.stepNum
                    });
                    onNotify(_("react-agent.notify.writeHalted"), "info");
                  }
                }
                else if (parsed.type === "paused") {
                  setCurrentStepInfo(_("react-agent.step.paused"));
                }
                else if (parsed.type === "model") {
                  // Which provider/model the chain actually resolved to (server.ts model event).
                  setCurrentStepInfo(`${_("react-agent.notify.modelRunning")} ${parsed.provider}/${parsed.model}`);
                }
                else if (parsed.type === "repair") {
                  // The agent is auto-repairing malformed tool args (server.ts repair event).
                  setCurrentStepInfo(`${_("react-agent.notify.repairing")} ${parsed.tool}`);
                }
                else if (parsed.type === "verify") {
                  // Verifier gate verdict — important agent feedback, was previously dropped.
                  onNotify(`${_("react-agent.notify.verifier")} ${parsed.verdict}${parsed.reason ? ` — ${String(parsed.reason).slice(0, 120)}` : ""}`, parsed.verdict === "PASS" ? "success" : "info");
                }
                else if (parsed.type === "done") {
                  setCurrentStepInfo(_("react-agent.step.done"));
                }
                else if (parsed.type === "error") {
                  onNotify(`${_("react-agent.notify.agentReasoner")} ${parsed.message}`, "error");
                  setCurrentStepInfo(_("react-agent.step.errorContext"));
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
      onNotify(`${_("react-agent.notify.runtimeFailed")} ${err.message}`, "error");
      setCurrentStepInfo(_("react-agent.step.disrupted"));
    } finally {
      runningRef.current = false;
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

      onNotify(`${_("react-agent.notify.applied")} ${pendingApproval.path}`, "success");
      // Update trace status in the list
      setTraceSteps((prev) =>
        prev.map((s) => s.stepNum === pendingApproval.stepIndex && s.tool === "write_file"
          ? { ...s, applied: true, result: _("react-agent.result.writtenManual") }
          : s
        )
      );
      setPendingApproval(null);

      // Let assistant know user approved
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `${_("react-agent.msg.approvedWrite.prefix")} \`${pendingApproval.path}\`. ${_("react-agent.msg.approvedWrite.suffix")}` }
      ]);
    } catch (err: any) {
      // non-ok responses previously parsed the JSON body for an error message
      const msg = err instanceof ApiError
        ? ((err.body as any)?.error || _("react-agent.notify.writeFailed"))
        : err.message;
      onNotify(`${_("react-agent.notify.approveError")} ${msg}`, "error");
    } finally {
      setApproving(false);
    }
  };

  const cancelWrite = () => {
    if (!pendingApproval) return;
    onNotify(_("react-agent.notify.writeRejected"), "info");
    setTraceSteps((prev) =>
      prev.map((s) => s.stepNum === pendingApproval.stepIndex && s.tool === "write_file"
        ? { ...s, result: _("react-agent.result.cancelled") }
        : s
      )
    );
    setPendingApproval(null);
  };

  return (
    <div className="space-y-6">
      
      {/* Upper Model Control Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-immersive-sidebar border border-immersive-border rounded-lg p-4">
        
        {/* Provider Choice */}
        <div className="space-y-1.5Col">
          <label htmlFor="react-agent-provider" className="text-[10px] font-mono text-immersive-text-dim uppercase tracking-wider font-bold">{_("react-agent.provider.label")}</label>
          <div className="relative">
            <select
              id="react-agent-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-immersive-panel border border-immersive-border-strong rounded px-3 py-2 text-xs font-mono text-immersive-text-bright outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
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
          <label htmlFor="react-agent-model" className="text-[10px] font-mono text-immersive-text-dim uppercase tracking-wider font-bold">{_("react-agent.model.label")}</label>
          <div className="relative">
            <select
              id="react-agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={loadingModels || modelsList.length === 0}
              className="w-full bg-immersive-panel border border-immersive-border-strong rounded px-3 py-2 text-xs font-mono text-immersive-text-bright outline-none focus:border-indigo-500/50 disabled:opacity-50"
            >
              {loadingModels ? (
                <option>{_("react-agent.model.loading")}</option>
              ) : modelsList.length === 0 ? (
                <option>{_("react-agent.model.empty")}</option>
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
          <div className="flex items-center justify-between border border-immersive-border bg-immersive-panel/40 rounded p-1 px-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-status-ok" />
              <span className="text-[11px] font-mono text-immersive-text-muted">{_("react-agent.autoApply.label")}</span>
            </div>
            <button
              onClick={() => {
                setAutoApply(!autoApply);
                onNotify(autoApply ? _("react-agent.notify.autoApplyOff") : _("react-agent.notify.autoApplyOn"), "info");
              }}
              className="text-immersive-text-muted hover:text-immersive-text-bright transition"
              title={_("react-agent.autoApply.title")}
            >
              {autoApply ? (
                <ToggleRight className="w-8 h-8 text-status-accent" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-immersive-text-dim" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace Frame */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

        {/* Sessions Sidebar Column picker (M6 / AC-A6) */}
        <div className="bg-immersive-sidebar border border-immersive-border rounded-lg p-4 flex flex-col justify-start space-y-3 xl:col-span-1 h-[470px]">
          <div className="flex items-center justify-between pb-2 border-b border-immersive-border">
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-immersive-text-muted" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-immersive-text-muted">{_("react-agent.sessions.title")}</span>
            </div>
            <button
              onClick={startNewSession}
              disabled={isLoading}
              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-status-accent border border-indigo-500/20 font-mono text-[9px] rounded px-2 py-0.5 transition select-none"
            >
              {_("react-agent.sessions.new")}
            </button>
          </div>

          <div className="space-y-1.5 flex-1 overflow-y-auto scrollbar-thin pr-1">
            {loadingSessions && sessions.length === 0 ? (
              <div className="text-[10px] font-mono text-immersive-text-dim text-center py-4">{_("react-agent.sessions.loading")}</div>
            ) : sessions.length === 0 ? (
              <div className="text-[10px] font-mono text-immersive-text-dim text-center py-4">{_("react-agent.sessions.empty")}</div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                // Guard a missing/invalid updatedAt → no "Invalid Date" in the list.
                const when = new Date(sess.updatedAt ?? 0);
                const formattedDate = isNaN(when.getTime()) ? "—" : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const shortModel = (sess.modelId ?? "—").split("/").pop();
                return (
                  <div
                    key={sess.id}
                    className={`group relative w-full p-2 rounded transition flex items-center justify-between border ${
                      isActive
                        ? "bg-indigo-500/10 border-indigo-500/30 text-status-accent"
                        : "bg-immersive-panel/30 border-immersive-border hover:bg-immersive-panel/60 text-immersive-text-muted hover:text-immersive-text-bright"
                    }`}
                  >
                    {/* Stretched-link: a single real button covers the whole row for
                        select; the delete button sits above it via z-index. Avoids
                        nested-interactive (FE a11y) while keeping native keyboard. */}
                    <button
                      type="button"
                      onClick={() => !isLoading && selectSession(sess.id)}
                      disabled={isLoading}
                      aria-label={`${_("react-agent.sessions.load")} ${sess.title}`}
                      className="absolute inset-0 w-full rounded cursor-pointer text-left disabled:cursor-default"
                    />
                    <div className="flex flex-col min-w-0 pr-1 truncate">
                      <span className="text-xs font-mono font-medium truncate leading-tight group-hover:text-immersive-text-bright">{sess.title}</span>
                      <span className="text-[9px] text-immersive-text-dim font-mono mt-0.5">{formattedDate} • {shortModel}</span>
                    </div>
                    <button
                      onClick={(e) => deleteSession(e, sess.id)}
                      className="relative z-10 opacity-0 group-hover:opacity-100 p-1 text-immersive-text-dim hover:text-status-err hover:bg-rose-500/10 rounded transition shrink-0"
                      title={_("react-agent.sessions.delete")}
                      aria-label={`${_("react-agent.sessions.delete")} ${sess.title}`}
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
            
            {/* Chat Bubble Console — aria-live so streaming output is announced to AT */}
            <div
              role="log"
              aria-live="polite"
              aria-label={_("react-agent.log.label")}
              className="flex-1 bg-immersive-sidebar border border-immersive-border rounded-lg p-4 h-[400px] overflow-y-auto space-y-4 scrollbar-thin"
            >
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
                    ? "bg-indigo-500 text-immersive-text-bright" 
                    : "bg-immersive-inset text-purple-300 border border-purple-500/20"
                }`}>
                  {m.role === "user" ? "U" : "A"}
                </div>

                {/* Content Bubble — assistant renders markdown/code; both copyable */}
                <div className={`group/msg relative p-3 rounded-lg text-xs leading-relaxed ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white font-medium whitespace-pre-wrap"
                    : "bg-immersive-panel border border-immersive-border text-immersive-text-muted font-mono"
                }`}>
                  <button
                    type="button"
                    onClick={() => copyText(m.content)}
                    aria-label={_("react-agent.copy")}
                    title={_("react-agent.copy")}
                    className="absolute top-1 right-1 opacity-0 group-hover/msg:opacity-100 p-1 rounded text-current transition"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {m.role === "assistant"
                    ? <AgentMessage content={m.content} copyLabel={_("react-agent.copy")} onCopy={copyText} />
                    : m.content}
                </div>
              </div>
            ))}
            
            {/* Typing status bar */}
            {isLoading && (
              <div className="flex items-center gap-3 mr-auto">
                <div className="w-7 h-7 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs text-status-accent animate-pulse">
                  R
                </div>
                <div className="px-3.5 py-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/10 text-xs font-mono text-immersive-text-muted flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  <span>{currentStepInfo || _("react-agent.status.thinking")}</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Interactive Chat Form — multi-line prompt: Enter runs, Shift+Enter = newline */}
          <form onSubmit={handleSendMessage} className="space-y-1">
            <div className="flex gap-2.5 items-stretch">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={_("react-agent.input.placeholder")}
                disabled={isLoading}
                rows={1}
                aria-label={_("react-agent.input.placeholder")}
                className="flex-1 resize-none bg-immersive-panel border border-immersive-border-strong rounded-lg px-4 py-3 text-xs font-mono text-immersive-text-bright outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 max-h-32"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopRun}
                  className="bg-rose-600 hover:bg-rose-500 text-immersive-text-bright shrink-0 px-5 rounded-lg flex items-center justify-center gap-2 transition text-xs font-bold"
                >
                  <X className="w-4 h-4" />
                  <span>{_("react-agent.stop")}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputMessage.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-immersive-text-bright shrink-0 px-5 rounded-lg flex items-center justify-center gap-2 transition text-xs font-bold"
                >
                  <CornerDownLeft className="w-4 h-4" />
                  <span>{_("react-agent.execute")}</span>
                </button>
              )}
            </div>
            <p className="text-[9px] font-mono text-immersive-text-dim px-1">{_("react-agent.input.hint")}</p>
          </form>
        </div>

        {/* Right Hand: Interactive Tool Status and Verification panels */}
        <div className="space-y-4">
          
          {/* List of core Tools */}
          <div className="bg-immersive-sidebar border border-immersive-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-immersive-border">
              <Hammer className="w-4 h-4 text-status-accent" />
              <h3 className="text-[10px] font-mono tracking-wider font-bold uppercase text-immersive-text-muted">{_("react-agent.tools.title")}</h3>
            </div>
            
            <div className="grid grid-cols-1 gap-2.5">
              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded border border-immersive-border">
                <FolderGit className="w-4 h-4 text-status-info shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">list_tree</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.listTree.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded border border-immersive-border">
                <FileText className="w-4 h-4 text-status-info shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">read_file</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.readFile.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded border border-immersive-border">
                <Braces className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">write_file</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.writeFile.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded border border-immersive-border">
                <Terminal className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">run_command</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.runCommand.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded border border-immersive-border">
                <Search className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">grep_search</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.grepSearch.desc")}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Approvals Widget */}
          {pendingApproval && (
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-status-warn shrink-0" />
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-status-warn">{_("react-agent.approval.title")}</h4>
              </div>
              <p className="text-[11px] font-mono text-immersive-text-muted leading-relaxed">
                {_("react-agent.approval.proposes")} <code className="bg-immersive-panel border border-immersive-border-strong px-1.5 py-0.5 rounded text-immersive-text-bright text-[10px]">{pendingApproval.path}</code>
              </p>

              {/* Diff Viewer Card */}
              <div className="bg-immersive-bg border border-immersive-border rounded p-2.5 max-h-48 overflow-y-auto font-mono text-[9px] text-immersive-text-muted whitespace-pre scrollbar-thin">
                {pendingApproval.diff}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={approveWrite}
                  disabled={approving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-immersive-text-bright py-2 rounded text-[10px] font-bold font-mono transition flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{approving ? _("react-agent.approval.writing") : _("react-agent.approval.approve")}</span>
                </button>
                <button
                  onClick={cancelWrite}
                  disabled={approving}
                  className="flex-1 bg-rose-950/40 hover:bg-rose-950 border border-rose-500/20 text-status-err py-2 rounded text-[10px] font-bold font-mono transition"
                >
                  {_("react-agent.approval.reject")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Real-time Steps Trace execution stream */}
      {traceSteps.length > 0 && (
        <div className="bg-immersive-sidebar border border-immersive-border rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-400" />
            <h3 className="text-[11px] font-mono tracking-widest font-bold uppercase text-immersive-text-muted">{_("react-agent.trace.title")}</h3>
          </div>

          <div className="overflow-x-auto border border-immersive-border rounded-md">
            <table className="w-full text-left font-mono text-immersive-text-muted border-collapse">
              <thead>
                <tr className="bg-immersive-panel/50 border-b border-immersive-border text-[10px] uppercase text-immersive-text-muted text-left">
                  <th className="px-4 py-3 font-semibold">{_("react-agent.trace.step")}</th>
                  <th className="px-4 py-3 font-semibold">{_("react-agent.trace.tool")}</th>
                  <th className="px-4 py-3 font-semibold">{_("react-agent.trace.args")}</th>
                  <th className="px-4 py-3 font-semibold">{_("react-agent.trace.latency")}</th>
                  <th className="px-4 py-3 font-semibold">{_("react-agent.trace.status")}</th>
                  <th className="px-4 py-3 font-semibold">{_("react-agent.trace.result")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {traceSteps.map((s, idx) => {
                  const isExpanded = expandedStep === s.stepNum;
                  const resultText = typeof s.result === "string" ? s.result : JSON.stringify(s.result);
                  return (
                  <React.Fragment key={idx}>
                  <tr
                    className="hover:bg-white/[0.01] transition duration-200 cursor-pointer"
                    onClick={() => setExpandedStep(isExpanded ? null : s.stepNum)}
                  >
                    <td className="px-4 py-3 text-status-accent font-bold whitespace-nowrap uppercase">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? _("react-agent.trace.collapse") : _("react-agent.trace.expand")}
                        onClick={(e) => { e.stopPropagation(); setExpandedStep(isExpanded ? null : s.stepNum); }}
                        className="flex items-center gap-1.5"
                      >
                        <ArrowRight className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        <span>{_("react-agent.trace.step")} {s.stepNum}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap text-purple-300 flex items-center gap-1.5 mt-0.5">
                      <Terminal className="w-3.5 h-3.5 text-status-info shrink-0" />
                      <span>{s.tool}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-immersive-text-muted whitespace-pre">
                      {JSON.stringify(s.args)}
                    </td>
                    <td className="px-4 py-3 text-immersive-text-muted font-medium whitespace-nowrap">{s.latency} ms</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.ok ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-status-ok">
                          {_("react-agent.trace.success")}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 border border-rose-500/20 text-status-err">
                          {_("react-agent.trace.failed")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-sm truncate whitespace-pre text-[10px] text-immersive-text-muted" title={resultText}>
                      {resultText}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-immersive-bg/60">
                      <td colSpan={6} className="px-4 py-3 space-y-3">
                        <div>
                          <div className="text-[9px] font-mono uppercase tracking-wider text-immersive-text-dim mb-1">{_("react-agent.trace.detailArgs")}</div>
                          <pre className="bg-immersive-panel border border-immersive-border rounded p-2.5 text-[10px] text-immersive-text-muted whitespace-pre-wrap overflow-x-auto scrollbar-thin">{JSON.stringify(s.args, null, 2)}</pre>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[9px] font-mono uppercase tracking-wider text-immersive-text-dim">{_("react-agent.trace.detailResult")}</div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); copyText(typeof s.result === "string" ? s.result : JSON.stringify(s.result, null, 2)); }}
                              aria-label={_("react-agent.copy")}
                              title={_("react-agent.copy")}
                              className="p-0.5 rounded text-immersive-text-dim hover:text-immersive-text-bright transition"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                          <pre className="bg-immersive-panel border border-immersive-border rounded p-2.5 text-[10px] text-immersive-text-muted whitespace-pre-wrap overflow-x-auto scrollbar-thin">{typeof s.result === "string" ? s.result : JSON.stringify(s.result, null, 2)}</pre>
                        </div>
                        {s.diff && (
                          <div>
                            <div className="text-[9px] font-mono uppercase tracking-wider text-immersive-text-dim mb-1">{_("react-agent.trace.detailDiff")}</div>
                            <pre className="bg-immersive-bg border border-immersive-border rounded p-2.5 text-[10px] text-immersive-text-muted whitespace-pre overflow-x-auto scrollbar-thin">{s.diff}</pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div ref={traceEndRef} />
        </div>
      )}
    </div>
  );
}
