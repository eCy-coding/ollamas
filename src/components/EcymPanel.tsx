import { useEffect, useState } from "react";
import { FlaskConical, Loader2, CheckCircle2, AlertCircle, Circle, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../lib/apiClient";

// eCy Studio (v10) — develops Emre's personal model. Shows the current ecy:latest
// (base, distilled system head, bench state) and runs the distillation loop:
// hardware+bench plan → Modelfile → ollama create → validation probe → version ledger.

interface EcymVersion { id: string; createdAt: string; base: string; numCtx: number; temperature: number; probeOk: boolean; note: string }
interface EcymStatus { exists: boolean; model: string; base: string; systemHead: string; benchAggs: number; championCandidate: string | null; versions: EcymVersion[] }
type StageId = "plan" | "modelfile" | "create" | "probe";
interface Stage { status: "pending" | "running" | "done" | "fail"; text?: string }

const STAGES: StageId[] = ["plan", "modelfile", "create", "probe"];
const LABEL: Record<StageId, string> = { plan: "Plan (hw + bench)", modelfile: "Modelfile", create: "ollama create", probe: "Validation probe" };
const fresh = (): Record<StageId, Stage> => ({ plan: { status: "pending" }, modelfile: { status: "pending" }, create: { status: "pending" }, probe: { status: "pending" } });

export function EcymPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [status, setStatus] = useState<EcymStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [stages, setStages] = useState<Record<StageId, Stage>>(fresh);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try { setStatus(await api.get<EcymStatus>("/api/ecym/status")); }
    catch (e) { setError(String((e as Error)?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const distill = async () => {
    setDistilling(true);
    setError("");
    setStages(fresh());
    let buf = "";
    try {
      await api.streamPost("/api/ecym/distill", { model: "ecy:latest" }, {
        onChunk: (t: string) => {
          buf += t;
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.stage === "error") { setError(ev.text || "distill failed"); continue; }
              if (ev.stage === "done") continue;
              setStages((s) => ({ ...s, [ev.stage]: { status: ev.status, text: ev.text ?? s[ev.stage as StageId]?.text } }));
            } catch { /* partial frame */ }
          }
        },
      });
      onNotify?.("eCy distilled — new ecy:latest is live", "success");
      void load();
    } catch (e) {
      setError(String((e as Error)?.message || e));
      onNotify?.("Distillation failed", "error");
    } finally {
      setDistilling(false);
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
        <FlaskConical className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold text-immersive-text-bright">eCy Studio</h2>
        <span className="text-xs text-immersive-text-muted">· distill &amp; evolve your personal model</span>
        <button onClick={() => void load()} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-immersive-panel border border-immersive-border hover:border-indigo-400/40 text-immersive-text-muted rounded text-sm transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex gap-2 p-3 bg-status-err/10 border border-status-err/30 rounded text-status-err text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {/* Current model card */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-immersive-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : status && (
        <div className="p-4 bg-immersive-panel border border-immersive-border rounded space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-immersive-text-bright">{status.model}</span>
            {status.exists ? (
              <span className="px-1.5 py-0.5 bg-status-ok/10 text-status-ok text-[10px] rounded">installed</span>
            ) : (
              <span className="px-1.5 py-0.5 bg-status-warn/10 text-status-warn text-[10px] rounded">not found — distill to create</span>
            )}
            <span className="text-xs text-immersive-text-muted">base: <span className="font-mono">{status.base}</span></span>
          </div>
          {status.systemHead && (
            <p className="text-xs text-immersive-text-muted font-mono whitespace-pre-wrap">{status.systemHead}…</p>
          )}
          <div className="text-xs text-immersive-text-muted">
            bench aggs: {status.benchAggs}
            {status.championCandidate
              ? <span className="text-status-warn"> · champion candidate: <span className="font-mono">{status.championCandidate}</span> (next distill would rebase)</span>
              : " · no better base measured — distill refreshes system + params"}
          </div>
        </div>
      )}

      {/* Distill */}
      <div className="space-y-2">
        <button
          onClick={() => void distill()}
          disabled={distilling}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {distilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {distilling ? "Distilling…" : "Distill eCy now"}
        </button>
        <div className="space-y-1.5">
          {STAGES.map((id) => {
            const s = stages[id];
            return (
              <div key={id} className="flex items-center gap-3 p-2 bg-immersive-panel border border-immersive-border/60 rounded text-sm">
                {icon(s.status)}
                <span className="text-immersive-text-bright w-40">{LABEL[id]}</span>
                {s.text && <span className="text-xs text-immersive-text-muted flex-1 truncate">{s.text}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Version ledger */}
      {status && status.versions.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-immersive-text-bright">Version history</h3>
          {status.versions.slice().reverse().map((v) => (
            <div key={v.id} className="flex items-center justify-between p-2 bg-immersive-panel border border-immersive-border/50 rounded text-xs">
              <span className="text-immersive-text-muted">
                {new Date(v.createdAt).toLocaleString()} · <span className="font-mono">{v.base}</span> · ctx {v.numCtx} · {v.note}
              </span>
              {v.probeOk ? <CheckCircle2 className="w-3.5 h-3.5 text-status-ok" /> : <AlertCircle className="w-3.5 h-3.5 text-status-err" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
