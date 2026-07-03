import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { GitBranch, Loader2, RefreshCw, ExternalLink, RotateCw, XCircle, ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { api } from "../lib/apiClient";

// "GitHub Actions" tab — lists workflow runs with status/conclusion badges,
// drill-down to jobs/steps, and (with a github vault token) re-run / cancel.
// Read paths work unauthenticated against public repos; writes need the token.
// Independent of any external service; plain Turkish strings (house style).

interface Run {
  id: number; name?: string; display_title?: string; head_branch?: string; event?: string;
  status?: string; conclusion?: string | null; run_number?: number; created_at?: string; html_url?: string;
  actor?: { login?: string }; head_commit?: { message?: string };
}
interface Job { name?: string; status?: string; conclusion?: string | null; steps?: { name?: string; status?: string; conclusion?: string | null; number?: number }[]; }
interface RunsResp { ok: boolean; authed: boolean; runs: Run[]; rateLimit?: { remaining: number; limit: number }; error?: string; }

// success→emerald, failure→rose, cancelled→slate, skipped/timed_out→amber; in-flight→sky.
function badge(run: Run): { label: string; cls: string } {
  if (run.status && run.status !== "completed") return { label: run.status, cls: "text-sky-300 bg-sky-950/40 border-sky-800" };
  const c = run.conclusion || "?";
  const map: Record<string, string> = {
    success: "text-emerald-300 bg-emerald-950/40 border-emerald-800",
    failure: "text-rose-300 bg-rose-950/30 border-rose-800",
    cancelled: "text-slate-400 bg-slate-800/40 border-slate-700",
    skipped: "text-amber-300 bg-amber-950/30 border-amber-800",
    timed_out: "text-amber-300 bg-amber-950/30 border-amber-800",
  };
  return { label: c, cls: map[c] || "text-slate-300 bg-slate-800/40 border-slate-700" };
}
const stepCls = (c?: string | null): string =>
  c === "success" ? "text-emerald-400" : c === "failure" ? "text-rose-400" : c === "skipped" ? "text-amber-400" : "text-slate-400";

export default function GitHubActionsPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [repo, setRepo] = useState("");
  const [data, setData] = useState<RunsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [jobs, setJobs] = useState<Record<number, Job[]>>({});
  const [acting, setActing] = useState<number | null>(null);

  const loadRuns = async (target: string, refresh = false) => {
    const r = target.trim();
    if (!r) return;
    setBusy(true); setErr("");
    try {
      const d = await api.get<RunsResp>(`/api/github/actions/runs?repo=${encodeURIComponent(r)}${refresh ? "&refresh=1" : ""}`);
      setData(d);
      if (!d.ok && d.error) setErr(d.error);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };

  // Auto-detect the repo from the git remote, then load its runs.
  useEffect(() => {
    (async () => {
      try {
        const hint = await api.get<{ slug: string | null }>("/api/github/actions/repo-hint");
        if (hint?.slug) { setRepo(hint.slug); loadRuns(hint.slug); }
      } catch { /* hint is best-effort */ }
    })();
  }, []);

  const toggleJobs = async (runId: number) => {
    if (expanded === runId) { setExpanded(null); return; }
    setExpanded(runId);
    if (!jobs[runId]) {
      try {
        const d = await api.get<{ ok: boolean; jobs: Job[] }>(`/api/github/actions/runs/${runId}/jobs?repo=${encodeURIComponent(repo)}`);
        setJobs((p) => ({ ...p, [runId]: d.jobs || [] }));
      } catch (e) { onNotify?.(`Jobs: ${String((e as Error)?.message || e)}`, "error"); }
    }
  };

  const act = async (runId: number, kind: "rerun" | "cancel") => {
    const verb = kind === "rerun" ? "başarısız job'ları yeniden çalıştır" : "çalışmayı iptal et";
    if (!window.confirm(`Emin misin: ${verb} (#${runId})?`)) return;
    setActing(runId);
    try {
      await api.post(`/api/github/actions/runs/${runId}/${kind}?repo=${encodeURIComponent(repo)}`, {});
      onNotify?.(kind === "rerun" ? "Yeniden çalıştırma tetiklendi" : "İptal gönderildi", "success");
      setTimeout(() => loadRuns(repo, true), 1500);
    } catch (e) { onNotify?.(`${kind}: ${String((e as Error)?.message || e)}`, "error"); }
    finally { setActing(null); }
  };

  const lowRate = data?.rateLimit && data.rateLimit.remaining < 10;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <GitBranch className="w-4 h-4 text-purple-400" />
        <span>GitHub Actions — workflow çalışmaları</span>
      </div>

      <div className="flex gap-2">
        <input
          value={repo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setRepo(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") loadRuns(repo, true); }}
          placeholder="owner/repo (ör. eCy-coding/ollamas)"
          className="flex-1 px-3 py-2 rounded border border-slate-600 bg-slate-900 text-sm text-slate-200 placeholder-slate-500 font-mono"
        />
        <button onClick={() => loadRuns(repo, true)} disabled={busy}
          className="flex items-center gap-1 px-3 py-2 rounded border border-slate-600 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Yükle
        </button>
      </div>

      {data && !data.authed && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/20 border border-amber-800 rounded p-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Salt-okunur (public repo). Yeniden-çalıştır/İptal için Gelir/Kişisel Ops'ta <code className="text-amber-200">provider=github</code> anahtarını bağla.</span>
        </div>
      )}
      {lowRate && (
        <div className="text-xs text-amber-300">GitHub API kotası azaldı: {data!.rateLimit!.remaining}/{data!.rateLimit!.limit} kaldı.</div>
      )}
      {err && <div className="text-rose-400 text-xs font-mono">{err}</div>}

      {data && data.runs.length === 0 && !err && <div className="text-slate-500 text-sm py-4 text-center">çalışma yok</div>}

      {data && data.runs.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded border border-slate-700">
          {data.runs.map((run) => {
            const b = badge(run);
            const inProgress = run.status && run.status !== "completed";
            return (
              <li key={run.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleJobs(run.id)} className="text-slate-400 hover:text-slate-200 shrink-0" aria-label="detayları aç">
                    {expanded === run.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${b.cls}`}>{b.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-200 truncate">{run.name || run.display_title || "(workflow)"} <span className="text-slate-500">#{run.run_number}</span></div>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      {run.head_branch} · {run.event} · {run.actor?.login}{run.created_at ? ` · ${run.created_at.slice(0, 10)}` : ""}
                      {run.head_commit?.message ? ` · ${run.head_commit.message.split("\n")[0]}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {data.authed && (
                      <>
                        <button onClick={() => act(run.id, "rerun")} disabled={acting === run.id} title="Başarısız job'ları yeniden çalıştır"
                          className="text-slate-400 hover:text-emerald-300 disabled:opacity-40 p-1">
                          {acting === run.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                        </button>
                        {inProgress && (
                          <button onClick={() => act(run.id, "cancel")} disabled={acting === run.id} title="Çalışmayı iptal et"
                            className="text-slate-400 hover:text-rose-300 disabled:opacity-40 p-1"><XCircle className="w-3.5 h-3.5" /></button>
                        )}
                      </>
                    )}
                    {run.html_url && (
                      <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-sky-300 p-1" aria-label="GitHub'da aç"><ExternalLink className="w-3.5 h-3.5" /></a>
                    )}
                  </div>
                </div>

                {expanded === run.id && (
                  <div className="mt-2 ml-6 border-l border-slate-800 pl-3 space-y-1.5">
                    {!jobs[run.id] ? (
                      <div className="text-[11px] text-slate-500">yükleniyor…</div>
                    ) : jobs[run.id]!.length === 0 ? (
                      <div className="text-[11px] text-slate-500">job yok</div>
                    ) : jobs[run.id]!.map((job, ji) => (
                      <div key={ji}>
                        <div className={`text-[11px] font-mono ${stepCls(job.conclusion)}`}>{job.name} — {job.conclusion || job.status}</div>
                        <div className="ml-3">
                          {(job.steps || []).map((s, si) => (
                            <div key={si} className={`text-[10px] font-mono ${stepCls(s.conclusion)}`}>{s.number}. {s.name} · {s.conclusion || s.status}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
