import React, { useState, useRef } from "react";
import { Users, Play, Check, X, Loader2 } from "lucide-react";

type Cell = { correct: boolean; tokPerSec: number };
type Results = Record<string, Record<string, Cell>>;

type Verdict = {
  models?: Record<string, { correct: number; total: number; pct: number }>;
  rates?: { singleBest?: number; bestOfN?: number; majority?: number };
  recommended?: { detail?: string; combination?: string };
  [k: string]: unknown;
};

export function CouncilPanel(): React.ReactElement {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Results>({});
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [tasks, setTasks] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  function stop(): void {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setRunning(false);
  }

  function calibrate(): void {
    setRunning(true);
    setResults({});
    setVerdict(null);
    setModels([]);
    setTasks([]);

    const es = new EventSource(
      "/api/council/calibrate?models=qwen3:4b,qwen3:8b,phi4"
    );
    esRef.current = es;

    es.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; model?: string; taskId?: string; cell?: Cell } & Verdict;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "result" && msg.model && msg.taskId && msg.cell) {
        const model = msg.model;
        const taskId = msg.taskId;
        const cell = msg.cell;
        setResults((prev) => ({
          ...prev,
          [model]: { ...(prev[model] ?? {}), [taskId]: cell },
        }));
        setModels((prev) => (prev.includes(model) ? prev : [...prev, model]));
        setTasks((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
      } else if (msg.type === "done") {
        setVerdict(msg);
        setRunning(false);
        es.close();
        esRef.current = null;
      }
    };

    es.onerror = () => {
      setRunning(false);
      es.close();
      esRef.current = null;
    };
  }

  const hasResults = models.length > 0;

  return (
    <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded shadow-lg min-h-[10rem]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-status-accent" /> Model Council ·
          Live Calibration
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={calibrate}
            disabled={running}
            aria-label="Calibrate the model council with live tasks"
            className="text-[10px] font-mono px-2 py-1 rounded border border-immersive-border bg-white/5 hover:bg-white/10 text-status-accent flex items-center gap-1 disabled:opacity-50"
          >
            {running ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Calibrating…
              </>
            ) : (
              <>
                <Play className="w-3 h-3" /> Calibrate
              </>
            )}
          </button>
          {running && (
            <button
              onClick={stop}
              aria-label="Stop the council calibration"
              className="text-[10px] font-mono px-2 py-1 rounded border border-immersive-border bg-white/5 hover:bg-white/10 text-status-err flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Stop
            </button>
          )}
        </div>
      </div>

      {!hasResults && !running ? (
        <p className="text-[11px] italic text-immersive-text-dim font-mono">
          Dispatch real tasks to the council →
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="font-mono text-[10px] w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-immersive-text-dim font-normal pr-3 pb-1">
                  model
                </th>
                {tasks.map((t) => (
                  <th
                    key={t}
                    className="text-left text-immersive-text-dim font-normal px-2 pb-1"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m}>
                  <td className="pr-3 py-0.5 text-immersive-text-dim">{m}</td>
                  {tasks.map((t) => {
                    const cell = results[m]?.[t];
                    return (
                      <td key={t} className="px-2 py-0.5">
                        {cell ? (
                          <span className="flex items-center gap-1">
                            {cell.correct ? (
                              <Check className="w-3 h-3 text-status-ok" />
                            ) : (
                              <X className="w-3 h-3 text-status-err" />
                            )}
                            <span className="text-immersive-text-dim">
                              {cell.tokPerSec.toFixed(0)} t/s
                            </span>
                          </span>
                        ) : (
                          <span className="text-immersive-text-dim">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verdict && (
        <div className="mt-3 pt-3 border-t border-immersive-border flex flex-col gap-2">
          {verdict.models && (
            <div className="flex flex-wrap gap-2 font-mono text-[10px]">
              {Object.entries(verdict.models).map(([m, s]: [string, { correct: number; total: number; pct: number }]) => (
                <span
                  key={m}
                  className="px-1.5 py-0.5 rounded bg-white/5 text-immersive-text-dim"
                >
                  {m}: {s.pct.toFixed(0)}%
                </span>
              ))}
            </div>
          )}
          {verdict.recommended?.detail && (
            <p className="font-mono text-[11px] text-emerald-400">
              {verdict.recommended.detail}
            </p>
          )}
          {verdict.rates && (
            <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
              {verdict.rates.singleBest != null && (
                <span className="px-1.5 py-0.5 rounded border border-immersive-border text-immersive-text-dim">
                  single-best {verdict.rates.singleBest.toFixed(0)}%
                </span>
              )}
              {verdict.rates.bestOfN != null && (
                <span className="px-1.5 py-0.5 rounded border border-immersive-border text-immersive-text-dim">
                  best-of-N {verdict.rates.bestOfN.toFixed(0)}%
                </span>
              )}
              {verdict.rates.majority != null && (
                <span className="px-1.5 py-0.5 rounded border border-immersive-border text-immersive-text-dim">
                  majority {verdict.rates.majority.toFixed(0)}%
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
