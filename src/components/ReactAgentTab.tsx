import React, { useState, useEffect, useRef } from "react";
import { useLingui } from "@lingui/react";
import {
  ToggleLeft, ToggleRight, Check, X,
  Terminal, ShieldCheck, History, AlertCircle,
  FileText, FolderGit, Search, Hammer, Braces, ArrowRight, CornerDownLeft, Copy,
  ChevronDown, Sparkles
} from "lucide-react";
import { ChatSession } from "../types";
import { api, ApiError } from "../lib/apiClient";
import { preferredOrFirstUsable } from "../lib/localModel";
import { AgentMessage } from "./AgentMessage";
import { ModelSettings } from "./ModelSettings";

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

// Colorize a unified-diff string line-by-line (+/− prefix → ok/err token color). Pure
// presentational helper (odyssey chat skin) — the diff CONTENT is untouched, only rendering.
function renderDiffLines(diff: string): React.ReactNode {
  return diff.split("\n").map((line, i) => {
    const cls = line.startsWith("+")
      ? "text-status-ok"
      : line.startsWith("-")
      ? "text-status-err"
      : "text-immersive-text-muted";
    return (
      <div key={i} className={cls}>
        {line.length > 0 ? line : " "}
      </div>
    );
  });
}

export function ReactAgentTab({ onNotify }: ReactAgentTabProps) {
  const { _ } = useLingui();
  // Default to the $0 local engine (justdoit: local models are the standing conductor) — fetchModels()
  // fills `model` with the first RUNNING local model on mount, so the panel works out-of-box with no key
  // and no manual provider switch. A saved session may restore a different (cloud) provider it was created with.
  const [provider, setProvider] = useState<string>("ollama-local");
  const [model, setModel] = useState<string>("");
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
  // Opt-in self-check: an INDEPENDENT verifier model reviews the final answer (implementer≠verifier gate,
  // justdoit verify step). Off by default (adds one verifier pass); the server no-ops if no verifier model.
  const [verify, setVerify] = useState<boolean>(false);
  const [currentStepInfo, setCurrentStepInfo] = useState<string>("");
  // Run lifecycle summary (from the server `done` event): clean finish vs depth-limit
  // truncation + the final throughput. null while no run has completed.
  const [runStatus, setRunStatus] = useState<"complete" | "limit" | null>(null);
  const [lastTokS, setLastTokS] = useState<number>(0);

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
      setProvider(data.providerId || "ollama-local");
      setModel(data.modelId || "");
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
    { id: "gemini-cli", label: "Gemini CLI (Local)", icon: "🔑" },
    { id: "openai", label: "OpenAI gpt-series", icon: "🟢" },
    { id: "anthropic", label: "Anthropic Claude", icon: "🎨" },
    { id: "openrouter", label: "OpenRouter Hub", icon: "🛰️" },
    { id: "ollama-local", label: "Ollama (Local Engine)", icon: "🏠" },
    { id: "ollama-cloud", label: "Ollama Cloud Infrastructure", icon: "🌩️" },
    { id: "vllm", label: "vLLM (Local)", icon: "⚡" },
    { id: "llamacpp", label: "llama.cpp (Local)", icon: "🦙" },
    // Bring-your-own endpoint (LM Studio / vLLM / litellm / any OpenAI-compatible URL).
    { id: "custom-openai", label: "Custom (OpenAI-compatible)", icon: "🔌" },
    // Free-tier OpenAI-compatible catalog (server/provider-catalog.ts). Selectable once a key
    // is set in the Vault; chat already routes these — the dropdown just surfaces them.
    { id: "groq", label: "Groq", icon: "⚙️" },
    { id: "cerebras", label: "Cerebras", icon: "🧠" },
    { id: "zai", label: "Z.ai", icon: "🇿" },
    { id: "sambanova", label: "SambaNova", icon: "🔷" },
    { id: "nvidia-nim", label: "NVIDIA NIM", icon: "🟩" },
    { id: "github-models", label: "GitHub Models", icon: "🐙" },
    { id: "mistral", label: "Mistral", icon: "🌬️" },
    { id: "cloudflare", label: "Cloudflare Workers AI", icon: "🟠" },
    { id: "scaleway", label: "Scaleway", icon: "🟣" },
    { id: "pollinations", label: "Pollinations (keyless)", icon: "🌸" }
  ];

  // Fetch real models whenever provider changes
  const fetchModels = async (prov: string) => {
    setLoadingModels(true);
    try {
      const list = await api.get<string[]>(`/api/models/${prov}`);
      setModelsList(list);
      if (list.length > 0) setModel((cur) => preferredOrFirstUsable(list, cur)); // keep a still-valid pick; skip cloud "no key" placeholders
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

  // Single dispatch path: stream the ReAct agent over the given history. Reused by a fresh
  // submit AND by the post-approval continuation (so the agent resumes after an approved write
  // instead of stalling). The caller sets up isLoading/runningRef/trace before calling.
  const streamAgent = async (history: Message[], sessionId: string | null) => {
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
          messages: history,
          autoApply,
          verify,
          maxSteps: 10,
          sessionId
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
                  if (typeof parsed.tokensPerSec === "number") setLastTokS(parsed.tokensPerSec);
                  const limit = parsed.status === "limit";
                  setRunStatus(limit ? "limit" : "complete");
                  // Tell the user when the run was TRUNCATED at the step cap (not a clean finish).
                  if (limit) onNotify(_("react-agent.notify.truncated"), "info");
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

  // Handle standard ReAct agent submit (fresh run).
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || isLoading || runningRef.current) return;
    runningRef.current = true;

    const userText = inputMessage.trim();
    setInputMessage("");
    setPendingApproval(null);

    setIsLoading(true);
    setTraceSteps([]);
    setRunStatus(null);
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
    await streamAgent(newMessages, currentSessionId);
  };

  const approveWrite = async () => {
    if (!pendingApproval) return;
    setApproving(true);
    try {
      await api.post("/api/agent/approve-write", {
        path: pendingApproval.path,
        content: pendingApproval.content
      });

      const approvedPath = pendingApproval.path;
      const approvedStep = pendingApproval.stepIndex;
      onNotify(`${_("react-agent.notify.applied")} ${approvedPath}`, "success");
      // Update trace status in the list
      setTraceSteps((prev) =>
        prev.map((s) => s.stepNum === approvedStep && s.tool === "write_file"
          ? { ...s, applied: true, result: _("react-agent.result.writtenManual") }
          : s
        )
      );
      setPendingApproval(null);

      // Resume the agent (human-in-the-loop): the file is now on disk → re-dispatch over the
      // same session with an approval note + a continuation cue, so the ReAct loop keeps going
      // instead of stalling after the paused write. Reuses the single streamAgent path.
      const note: Message = {
        role: "assistant",
        content: `${_("react-agent.msg.approvedWrite.prefix")} \`${approvedPath}\`. ${_("react-agent.msg.approvedWrite.suffix")}`
      };
      const resume: Message = { role: "user", content: `${_("react-agent.msg.approvedContinue")} ${approvedPath}` };
      const history: Message[] = [...messages, note, resume];
      setMessages(history);
      if (!runningRef.current) {
        runningRef.current = true;
        setIsLoading(true);
        setRunStatus(null);
        setCurrentStepInfo(_("react-agent.step.spinningUp"));
        void streamAgent(history, activeSessionId);
      }
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-immersive-sidebar border border-immersive-border rounded-xl p-4 shadow-sm">
        
        {/* Provider Choice */}
        <div className="space-y-1.5">
          <label htmlFor="react-agent-provider" className="text-[10px] font-mono text-immersive-text-dim uppercase tracking-wider font-bold">{_("react-agent.provider.label")}</label>
          <div className="relative">
            <select
              id="react-agent-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-immersive-panel border border-immersive-border-strong rounded-lg px-3 py-2 text-xs font-mono text-immersive-text-bright outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-500/30 appearance-none cursor-pointer transition-colors"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" className="w-3.5 h-3.5 text-immersive-text-dim absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
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
              className="w-full bg-immersive-panel border border-immersive-border-strong rounded-lg px-3 py-2 text-xs font-mono text-immersive-text-bright outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:opacity-50 appearance-none cursor-pointer transition-colors"
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
            <ChevronDown aria-hidden="true" className="w-3.5 h-3.5 text-immersive-text-dim absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          {/* Per-model overrides (M-038) live where the model is picked. */}
          <ModelSettings model={model} onNotify={onNotify} />
        </div>

        {/* Toggles & Actions */}
        <div className="flex flex-col justify-end space-y-1.5">
          <div className="flex items-center justify-between border border-immersive-border bg-immersive-panel/40 rounded-lg p-1 px-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-status-ok" />
              <span className="text-[11px] font-mono text-immersive-text-muted">{_("react-agent.autoApply.label")}</span>
            </div>
            <button
              onClick={() => {
                setAutoApply(!autoApply);
                onNotify(autoApply ? _("react-agent.notify.autoApplyOff") : _("react-agent.notify.autoApplyOn"), "info");
              }}
              className="text-immersive-text-muted hover:text-immersive-text-bright transition rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              title={_("react-agent.autoApply.title")}
            >
              {autoApply ? (
                <ToggleRight className="w-8 h-8 text-status-accent" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-immersive-text-dim" />
              )}
            </button>
          </div>
          {/* Self-check gate: an independent verifier model reviews the final answer (justdoit verify). */}
          <div className="flex items-center justify-between border border-immersive-border bg-immersive-panel/40 rounded-lg p-1 px-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-status-warn" />
              <span className="text-[11px] font-mono text-immersive-text-muted">{_("react-agent.verify.label")}</span>
            </div>
            <button
              onClick={() => {
                setVerify(!verify);
                onNotify(verify ? _("react-agent.verify.off") : _("react-agent.verify.on"), "info");
              }}
              className="text-immersive-text-muted hover:text-immersive-text-bright transition rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              title={_("react-agent.verify.title")}
            >
              {verify ? (
                <ToggleRight className="w-8 h-8 text-status-warn" />
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
        <div className="bg-immersive-sidebar border border-immersive-border rounded-xl p-4 flex flex-col justify-start space-y-3 xl:col-span-1 h-[470px] shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-immersive-border">
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-immersive-text-muted" />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-immersive-text-muted">{_("react-agent.sessions.title")}</span>
            </div>
            <button
              onClick={startNewSession}
              disabled={isLoading}
              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-status-accent border border-indigo-500/20 font-mono text-[9px] rounded px-2 py-0.5 transition select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
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
                    className={`group relative w-full p-2 rounded-lg transition flex items-center justify-between border ${
                      isActive
                        ? "bg-indigo-500/10 border-indigo-500/30 text-status-accent"
                        : "bg-immersive-panel/30 border-immersive-border hover:bg-immersive-panel/60 text-immersive-text-muted hover:text-immersive-text-bright"
                    }`}
                  >
                    {/* Active-session accent strip — reinforces selection beyond color alone (V9 a11y). */}
                    {isActive && <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-indigo-500" />}
                    {/* Stretched-link: a single real button covers the whole row for
                        select; the delete button sits above it via z-index. Avoids
                        nested-interactive (FE a11y) while keeping native keyboard. */}
                    <button
                      type="button"
                      onClick={() => !isLoading && selectSession(sess.id)}
                      disabled={isLoading}
                      aria-label={`${_("react-agent.sessions.load")} ${sess.title}`}
                      className="absolute inset-0 w-full rounded-lg cursor-pointer text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                    />
                    <div className="flex flex-col min-w-0 pr-1 pl-1 truncate">
                      <span className="text-xs font-mono font-medium truncate leading-tight group-hover:text-immersive-text-bright">{sess.title}</span>
                      <span className="text-[9px] text-immersive-text-dim font-mono mt-0.5">{formattedDate} • {shortModel}</span>
                    </div>
                    <button
                      onClick={(e) => deleteSession(e, sess.id)}
                      className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-immersive-text-dim hover:text-status-err hover:bg-rose-500/10 rounded transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
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
              className="flex-1 bg-immersive-sidebar border border-immersive-border rounded-xl p-4 h-[400px] overflow-y-auto space-y-4 scrollbar-thin shadow-sm"
            >
              {messages.filter(m => m.role === "user" || m.role === "assistant").map((m, idx) => (
              <div
                key={idx}
                className={`flex gap-3 max-w-[85%] ${
                  m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                }`}
              >
                {/* Avatar Icon */}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 shadow-sm ${
                  m.role === "user"
                    ? "bg-indigo-500 text-immersive-text-bright"
                    : "bg-gradient-to-br from-indigo-500 to-purple-400 text-white"
                }`}>
                  {m.role === "user" ? "U" : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                </div>

                {/* Content Bubble — assistant renders markdown/code; both copyable.
                    Asymmetric "tail" corner on the sender side (odyssey chat skin). */}
                <div className={`group/msg relative p-3 text-xs leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "rounded-2xl rounded-br-md bg-indigo-600 text-white font-medium whitespace-pre-wrap"
                    : "rounded-2xl rounded-bl-md bg-immersive-panel border border-immersive-border text-immersive-text-muted font-mono"
                }`}>
                  <button
                    type="button"
                    onClick={() => copyText(m.content)}
                    aria-label={_("react-agent.copy")}
                    title={_("react-agent.copy")}
                    className="absolute top-1 right-1 opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 p-1 rounded text-current transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/50"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {m.role === "assistant"
                    ? <AgentMessage content={m.content} copyLabel={_("react-agent.copy")} onCopy={copyText} />
                    : m.content}
                </div>
              </div>
            ))}

            {/* Reasoning-trace status strip — soft/italic "thought" line, visually distinct from
                tool-call cards via a left accent bar (odyssey chat skin, HANDOFF §6). */}
            {isLoading && (
              <div className="flex items-center gap-3 mr-auto max-w-[85%]">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-400 flex items-center justify-center text-white shrink-0 shadow-sm animate-pulse">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
                <div className="relative pl-3 pr-3.5 py-2.5 rounded-lg rounded-bl-md bg-indigo-500/5 border border-indigo-500/10 text-xs font-mono text-immersive-text-muted italic flex items-center gap-2">
                  <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-indigo-400/70" />
                  <span>{currentStepInfo || _("react-agent.status.thinking")}</span>
                  <span aria-hidden="true" className="inline-block w-1.5 h-3.5 bg-indigo-400 animate-pulse rounded-sm" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Interactive Chat Form — multi-line prompt: Enter runs, Shift+Enter = newline.
              Unified composer "card" (odyssey chat skin): border/shadow/focus-within live on
              the wrapper so the whole control reads as one surface, with a thin top pulse
              while a run is in flight — purely presentational, driven by existing isLoading. */}
          <form onSubmit={handleSendMessage} className="space-y-1">
            <div
              className={`relative flex gap-2.5 items-stretch rounded-xl border bg-immersive-panel/40 p-1.5 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-indigo-500/20 ${
                isLoading ? "border-indigo-500/40" : "border-immersive-border-strong focus-within:border-indigo-500/40"
              }`}
            >
              {isLoading && (
                <span aria-hidden="true" className="absolute -top-px left-3 right-3 h-0.5 rounded-full bg-indigo-500/60 animate-pulse" />
              )}
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
                className="flex-1 resize-none bg-transparent border-none rounded-lg px-3 py-2 text-xs font-mono text-immersive-text-bright outline-none max-h-32"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopRun}
                  className="bg-rose-700 hover:bg-rose-600 text-white shrink-0 px-5 rounded-lg flex items-center justify-center gap-2 transition text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                >
                  <X className="w-4 h-4" />
                  <span>{_("react-agent.stop")}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputMessage.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-immersive-text-bright shrink-0 px-5 rounded-lg flex items-center justify-center gap-2 transition text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
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
          <div className="bg-immersive-sidebar border border-immersive-border rounded-xl p-4 space-y-3 shadow-sm">
            <div className="flex items-center gap-2 pb-2 border-b border-immersive-border">
              <Hammer className="w-4 h-4 text-status-accent" />
              <h3 className="text-[10px] font-mono tracking-wider font-bold uppercase text-immersive-text-muted">{_("react-agent.tools.title")}</h3>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded-lg border border-immersive-border transition-colors hover:border-immersive-border-strong">
                <FolderGit className="w-4 h-4 text-status-info shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">list_tree</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.listTree.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded-lg border border-immersive-border transition-colors hover:border-immersive-border-strong">
                <FileText className="w-4 h-4 text-status-info shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">read_file</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.readFile.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded-lg border border-immersive-border transition-colors hover:border-immersive-border-strong">
                <Braces className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">write_file</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.writeFile.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded-lg border border-immersive-border transition-colors hover:border-immersive-border-strong">
                <Terminal className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[10px] font-mono font-bold text-immersive-text-muted">run_command</h4>
                  <p className="text-[9px] text-immersive-text-dim font-mono">{_("react-agent.tools.runCommand.desc")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 bg-immersive-bg rounded-lg border border-immersive-border transition-colors hover:border-immersive-border-strong">
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
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-status-warn shrink-0" />
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-status-warn">{_("react-agent.approval.title")}</h4>
              </div>
              <p className="text-[11px] font-mono text-immersive-text-muted leading-relaxed">
                {_("react-agent.approval.proposes")} <code className="bg-immersive-panel border border-immersive-border-strong px-1.5 py-0.5 rounded text-immersive-text-bright text-[10px]">{pendingApproval.path}</code>
              </p>

              {/* Diff Viewer Card — +/− lines colorized (ok/err tokens) so additions/removals
                  read at a glance, matching the odyssey chat design's diff preview. */}
              <div className="bg-immersive-bg border border-immersive-border rounded-lg p-2.5 max-h-48 overflow-y-auto font-mono text-[9px] whitespace-pre scrollbar-thin">
                {renderDiffLines(pendingApproval.diff)}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={approveWrite}
                  disabled={approving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-immersive-text-bright py-2 rounded-lg text-[10px] font-bold font-mono transition flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{approving ? _("react-agent.approval.writing") : _("react-agent.approval.approve")}</span>
                </button>
                <button
                  onClick={cancelWrite}
                  disabled={approving}
                  className="flex-1 bg-rose-950/40 hover:bg-rose-950 border border-rose-500/20 text-status-err py-2 rounded-lg text-[10px] font-bold font-mono transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                >
                  {_("react-agent.approval.reject")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Run summary — surfaced from the server `done` event (steps · tok/s · clean-vs-truncated) */}
      {runStatus && !isLoading && (
        <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono bg-immersive-sidebar border border-immersive-border rounded-xl px-4 py-2.5 shadow-sm">
          <span className="text-immersive-text-muted">{traceSteps.length} {_("react-agent.summary.steps")}</span>
          {lastTokS > 0 && <span className="text-immersive-text-muted">· {lastTokS} {_("react-agent.summary.tokps")}</span>}
          <span
            className={`ml-auto px-2 py-0.5 rounded font-bold ${
              runStatus === "limit"
                ? "bg-amber-500/10 border border-amber-500/20 text-status-warn"
                : "bg-emerald-500/10 border border-emerald-500/20 text-status-ok"
            }`}
          >
            {runStatus === "limit" ? _("react-agent.summary.truncated") : _("react-agent.summary.complete")}
          </span>
        </div>
      )}

      {/* Real-time Steps Trace execution stream */}
      {traceSteps.length > 0 && (
        <div className="bg-immersive-sidebar border border-immersive-border rounded-xl p-4 space-y-4 shadow-sm">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-400" />
            <h3 className="text-[11px] font-mono tracking-widest font-bold uppercase text-immersive-text-muted">{_("react-agent.trace.title")}</h3>
          </div>

          <div className="overflow-x-auto border border-immersive-border rounded-lg">
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
                    className="hover:bg-immersive-panel/40 transition-colors duration-200 cursor-pointer"
                    onClick={() => setExpandedStep(isExpanded ? null : s.stepNum)}
                  >
                    <td className="px-4 py-3 text-status-accent font-bold whitespace-nowrap uppercase">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? _("react-agent.trace.collapse") : _("react-agent.trace.expand")}
                        onClick={(e) => { e.stopPropagation(); setExpandedStep(isExpanded ? null : s.stepNum); }}
                        className="flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
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
                              className="p-0.5 rounded text-immersive-text-dim hover:text-immersive-text-bright transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
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
