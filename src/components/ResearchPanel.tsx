import { useState } from "react";
import { Search, Loader2, CheckCircle2, AlertCircle, Circle, ExternalLink, Copy } from "lucide-react";
import { api } from "../lib/apiClient";

// Deep Research (P1) — ask a question → backend plans sub-queries → web-searches →
// summarises each source with the $0-local model → streams a cited report over SSE.
// Report is shown as plain text (React auto-escapes; no dangerouslySetInnerHTML → XSS-safe).

type StageId = "plan" | "fetch" | "summarize" | "synthesize";
interface Stage { status: "pending" | "running" | "done" | "fail"; text?: string; progress?: number }
interface Source { title: string; url: string; snippet?: string }

const STAGES: StageId[] = ["plan", "fetch", "summarize", "synthesize"];
const STAGE_LABEL: Record<StageId, string> = { plan: "Plan", fetch: "Fetch", summarize: "Summarize", synthesize: "Synthesize" };
const freshStages = (): Record<StageId, Stage> => ({
  plan: { status: "pending" }, fetch: { status: "pending" }, summarize: { status: "pending" }, synthesize: { status: "pending" },
});

export function ResearchPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<StageId, Stage>>(freshStages);
  const [report, setReport] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");

  const run = async () => {
    const q = query.trim();
    if (!q) { onNotify?.("Enter a research question", "error"); return; }
    setRunning(true); setReport(""); setSources([]); setError(""); setStages(freshStages());
    let buf = "";
    try {
      await api.streamPost("/api/research", { question: q }, {
        onChunk: (text: string) => {
          buf += text;
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            let ev: { stage?: StageId | "error"; status?: Stage["status"]; text?: string; progress?: number; error?: string; done?: boolean; report?: string; sources?: Source[] };
            try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
            if (ev.error) { setError(ev.error); onNotify?.(ev.error, "error"); continue; }
            if (ev.stage && ev.stage !== "error" && ev.status) {
              const stage = ev.stage as StageId;
              setStages((s) => ({ ...s, [stage]: { status: ev.status!, text: ev.text ?? s[stage].text, progress: ev.progress } }));
              if (stage === "synthesize" && ev.status === "running" && ev.text) setReport((r) => r + ev.text);
              if (stage === "synthesize" && ev.status === "done" && ev.report) setReport(ev.report);
            }
            if (ev.done) { if (ev.sources) setSources(ev.sources); }
          }
        },
      });
      onNotify?.("Research complete", "success");
    } catch (e) {
      setError(String((e as Error)?.message || e));
      onNotify?.("Research failed", "error");
    } finally {
      setRunning(false);
    }
  };

  const icon = (st: Stage["status"]) =>
    st === "running" ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
      : st === "done" ? <CheckCircle2 className="w-4 h-4 text-status-ok" />
      : st === "fail" ? <AlertCircle className="w-4 h-4 text-status-err" />
      : <Circle className="w-4 h-4 text-immersive-text-muted" />;

  return (
    <div className="space-y-5 p-6 bg-immersive-sidebar border border-immersive-border rounded max-w-4xl">
      <div className="flex items-center gap-2">
        <Search className="w-5 h-5 text-indigo-400" />
        <h2 className="text-lg font-semibold text-immersive-text-bright">Deep Research</h2>
        <span className="text-xs text-immersive-text-muted">· qwen3:8b · $0 local</span>
      </div>

      <div className="flex gap-2">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What would you like to research?"
          rows={2}
          disabled={running}
          className="flex-1 px-3 py-2 bg-immersive-panel border border-immersive-border rounded text-sm text-immersive-text-bright placeholder-immersive-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
        />
        <button
          onClick={() => void run()}
          disabled={running}
          className="px-4 self-stretch flex items-center gap-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {running ? "Researching…" : "Research"}
        </button>
      </div>

      {error && (
        <div className="flex gap-2 p-3 bg-status-err/10 border border-status-err/30 rounded text-status-err text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        {STAGES.map((id) => {
          const s = stages[id];
          return (
            <div key={id} className="flex items-center gap-3 p-2 bg-immersive-panel border border-immersive-border/60 rounded text-sm">
              {icon(s.status)}
              <span className="text-immersive-text-bright w-24">{STAGE_LABEL[id]}</span>
              {s.text && <span className="text-xs text-immersive-text-muted flex-1">{s.text}</span>}
              {s.progress !== undefined && s.status === "running" && (
                <div className="w-24 h-1 bg-immersive-border rounded-full overflow-hidden">
                  <div className="h-1 bg-indigo-500" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {report && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-immersive-text-bright">Report</h3>
            <button onClick={() => { void navigator.clipboard?.writeText(report); onNotify?.("Copied", "info"); }} className="flex items-center gap-1 text-xs text-immersive-text-muted hover:text-immersive-text-bright">
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <pre className="p-4 bg-immersive-panel border border-immersive-border rounded text-xs text-immersive-text-dim max-h-96 overflow-auto whitespace-pre-wrap break-words leading-relaxed">{report}</pre>
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-immersive-text-bright">Sources ({sources.length})</h3>
          {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-immersive-text-muted hover:text-indigo-300">
              <span className="text-indigo-400">[{i + 1}]</span>
              <span className="truncate">{s.title || s.url}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
