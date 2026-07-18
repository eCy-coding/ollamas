import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2, Plus, Trash2, AlertCircle } from "lucide-react";
import { api } from "../lib/apiClient";
import { AgentMessage } from "./AgentMessage";

// Chat (v10) — the odysseus-core service: talk to the $0-local models (eCy first).
// Streams over the existing POST /api/generate SSE contract; sessions persist via
// the existing /api/agent/sessions store (+ the v10 PUT for message updates).

interface ChatMsg { id: string; role: "user" | "assistant" | string; content: string; timestamp: string }
interface Session { id: string; title: string; modelId: string; providerId: string; messages: ChatMsg[]; updatedAt: string }

const PROVIDER = "ollama-local";
const PREFERRED_MODEL = "ecy:latest";
const newId = () => Math.random().toString(36).slice(2, 10);

export function ChatPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>(PREFERRED_MODEL);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [tokS, setTokS] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<string[]>(`/api/models/${PROVIDER}`)
      .then((list) => { if (alive) { setModels(list); if (!list.includes(PREFERRED_MODEL) && list[0]) setModel(list[0]); } })
      .catch(() => { if (alive) setModels([]); });
    api.get<Session[]>("/api/agent/sessions")
      .then((s) => { if (alive) setSessions(s); })
      .catch(() => { /* session list is best-effort */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const persist = async (id: string, msgs: ChatMsg[], firstUserText?: string) => {
    try {
      await api.put(`/api/agent/sessions/${id}`, {
        messages: msgs,
        modelId: model,
        ...(firstUserText ? { title: firstUserText.slice(0, 60) } : {}),
      });
    } catch { /* persistence is best-effort; the chat itself already succeeded */ }
  };

  const ensureSession = async (firstUserText: string): Promise<string> => {
    if (sessionId) return sessionId;
    const created = await api.post<{ id?: string } & Session>("/api/agent/sessions", {
      title: firstUserText.slice(0, 60) || "New Chat",
      providerId: PROVIDER,
      modelId: model,
    });
    const id = created.id!;
    setSessionId(id);
    setSessions((s) => [{ ...(created as Session) }, ...s]);
    return id;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError("");
    setTokS(null);
    const userMsg: ChatMsg = { id: newId(), role: "user", content: text, timestamp: new Date().toISOString() };
    const draft: ChatMsg = { id: newId(), role: "assistant", content: "", timestamp: new Date().toISOString() };
    const base = [...messages, userMsg];
    setMessages([...base, draft]);
    setStreaming(true);
    const started = Date.now();
    let acc = "";
    let buf = "";
    try {
      const id = await ensureSession(text);
      await api.streamPost("/api/generate", {
        provider: PROVIDER,
        model,
        stream: true,
        messages: base.map((m) => ({ role: m.role, content: m.content })),
      }, {
        onChunk: (t: string) => {
          buf += t;
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const f = JSON.parse(line.slice(5).trim());
              if (f.chunk) {
                acc += f.chunk;
                setMessages((cur) => cur.map((m) => (m.id === draft.id ? { ...m, content: acc } : m)));
              } else if (f.error) {
                setError(String(f.error));
              }
            } catch { /* partial frame */ }
          }
        },
      });
      const secs = (Date.now() - started) / 1000;
      if (acc && secs > 0) setTokS(Math.round(acc.length / 4 / secs)); // ~4 chars/token estimate
      const finalMsgs = [...base, { ...draft, content: acc }];
      setMessages(finalMsgs);
      void persist(id, finalMsgs, base.length === 1 ? text : undefined);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setError(msg);
      onNotify?.(`Chat failed: ${msg}`, "error");
      setMessages(base); // drop the empty draft on hard failure — honest state
    } finally {
      setStreaming(false);
    }
  };

  const loadSession = async (s: Session) => {
    try {
      const full = await api.get<Session>(`/api/agent/sessions/${s.id}`);
      setSessionId(full.id);
      setMessages(full.messages ?? []);
      if (full.modelId && models.includes(full.modelId)) setModel(full.modelId);
    } catch {
      onNotify?.("Failed to load session", "error");
    }
  };

  const newChat = () => { setSessionId(null); setMessages([]); setError(""); setTokS(null); };

  const deleteSession = async (id: string) => {
    try {
      await api.del(`/api/agent/sessions/${id}`);
      setSessions((s) => s.filter((x) => x.id !== id));
      if (sessionId === id) newChat();
    } catch { onNotify?.("Delete failed", "error"); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[230px_1fr] gap-4 p-6 bg-immersive-sidebar border border-immersive-border rounded min-h-[30rem]">
      {/* Sessions rail */}
      <div className="flex flex-col gap-2">
        <button onClick={newChat} className="flex items-center justify-center gap-1.5 py-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Chat
        </button>
        <div className="flex-1 overflow-auto max-h-[26rem] space-y-1">
          {sessions.length === 0 ? (
            <div className="text-xs text-immersive-text-muted text-center py-4">No sessions yet.</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className={`group flex items-center gap-1 px-2 py-1.5 rounded text-xs cursor-pointer ${sessionId === s.id ? "bg-indigo-500/10 text-indigo-300" : "text-immersive-text-muted hover:bg-white/5"}`}>
                <button onClick={() => void loadSession(s)} className="flex-1 text-left truncate">{s.title}</button>
                <button onClick={() => void deleteSession(s.id)} className="opacity-0 group-hover:opacity-100 text-status-err transition-opacity" title="Delete">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-immersive-text-bright">Chat</h2>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={streaming}
            aria-label="Model"
            className="ml-auto bg-immersive-panel border border-immersive-border rounded px-2 py-1 text-xs text-immersive-text-bright focus:outline-none"
          >
            {(models.length ? models : [model]).map((m) => (
              <option key={m} value={m}>{m}{m === PREFERRED_MODEL ? " · eCy" : ""}</option>
            ))}
          </select>
          <span className="text-xs text-immersive-text-muted">$0 local{tokS ? ` · ~${tokS} tok/s` : ""}</span>
        </div>

        {error && (
          <div className="flex gap-2 p-2.5 bg-status-err/10 border border-status-err/30 rounded text-status-err text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 min-h-[18rem] max-h-[24rem] overflow-auto space-y-3 p-3 bg-immersive-panel border border-immersive-border rounded">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-immersive-text-muted text-sm">
              Talk to eCy — fully local, nothing leaves this machine.
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={`inline-block max-w-[85%] px-3 py-2 rounded text-sm text-left ${m.role === "user" ? "bg-indigo-500/15 text-immersive-text-bright" : "bg-immersive-sidebar border border-immersive-border/60 text-immersive-text-dim"}`}>
                  {m.role === "assistant" ? (
                    m.content ? (
                      <AgentMessage content={m.content} copyLabel="Copy" onCopy={() => onNotify?.("Copied", "info")} />
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-immersive-text-muted" />
                    )
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{m.content}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Message eCy… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={streaming}
            className="flex-1 px-3 py-2 bg-immersive-panel border border-immersive-border rounded text-sm text-immersive-text-bright placeholder-immersive-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 resize-none"
          />
          <button
            onClick={() => void send()}
            disabled={streaming || !input.trim()}
            className="px-4 self-stretch flex items-center gap-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm font-medium transition-colors disabled:opacity-40"
          >
            {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
