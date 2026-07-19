import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { GitBranch, Loader2, RefreshCw, ExternalLink, RotateCw, XCircle, ChevronRight, ChevronDown, AlertTriangle, FileText, Play } from "lucide-react";
import { api } from "../lib/apiClient";
import { AssistDrawer } from "./AssistDrawer";

// "GitHub Actions" tab — lists workflow runs with status/conclusion badges,
// drill-down to jobs/steps, and (with a github vault token) re-run / cancel.
// Read paths work unauthenticated against public repos; writes need the token.
// Independent of any external service; plain Turkish strings (house style).

interface Run {
  id: number; name?: string; display_title?: string; head_branch?: string; event?: string;
  status?: string; conclusion?: string | null; run_number?: number; created_at?: string; updated_at?: string; html_url?: string;
  actor?: { login?: string }; head_commit?: { message?: string };
}
interface Job { id: number; name?: string; status?: string; conclusion?: string | null; steps?: { name?: string; status?: string; conclusion?: string | null; number?: number }[]; }
interface RunsResp { ok: boolean; authed: boolean; runs: Run[]; rateLimit?: { remaining: number; limit: number }; error?: string; }
interface Workflow { id: number; name?: string; path?: string; }

// created_at → updated_at as "3m 42s" (best-effort; empty when unknown).
function duration(a?: string, b?: string): string {
  if (!a || !b) return "";
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

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
  const [logs, setLogs] = useState<Record<number, { text: string; truncated?: boolean; loading?: boolean }>>({});
  const [failuresOnly, setFailuresOnly] = useState(false);
  // Workflow dispatch
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [showTrigger, setShowTrigger] = useState(false);
  const [wfId, setWfId] = useState("");
  const [wfRef, setWfRef] = useState("main");
  const [wfInputs, setWfInputs] = useState("");
  const [dispatching, setDispatching] = useState(false);

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

  const loadLog = async (jobId: number) => {
    if (logs[jobId] && !logs[jobId].loading) { setLogs((p) => { const n = { ...p }; delete n[jobId]; return n; }); return; } // toggle off
    setLogs((p) => ({ ...p, [jobId]: { text: "", loading: true } }));
    try {
      const d = await api.get<{ ok: boolean; text?: string; truncated?: boolean; error?: string }>(`/api/github/actions/jobs/${jobId}/log?repo=${encodeURIComponent(repo)}`);
      // GitHub gates job logs behind auth even for public repos — surface an
      // actionable message rather than a bare 403 when no token is connected.
      const msg = d.ok ? (d.text || "(boş)")
        : (!data?.authed && /403/.test(d.error || "")) ? "Job log için GitHub token gerekli (Gelir/Kişisel Ops → provider=github)."
        : `log alınamadı: ${d.error || "?"}`;
      setLogs((p) => ({ ...p, [jobId]: { text: msg, truncated: d.truncated } }));
    } catch (e) { setLogs((p) => ({ ...p, [jobId]: { text: `log hatası: ${String((e as Error)?.message || e)}` } })); }
  };

  const openTrigger = async () => {
    setShowTrigger((v) => !v);
    if (!showTrigger && workflows.length === 0) {
      try {
        const d = await api.get<{ ok: boolean; workflows: Workflow[] }>(`/api/github/actions/workflows?repo=${encodeURIComponent(repo)}`);
        setWorkflows(d.workflows || []);
        if (d.workflows?.[0]) setWfId(String(d.workflows[0].id));
      } catch (e) { onNotify?.(`Workflows: ${String((e as Error)?.message || e)}`, "error"); }
    }
  };

  // Parse "KEY=VALUE" lines OR a JSON object into an inputs map.
  const parseInputs = (raw: string): Record<string, string> | null => {
    const s = raw.trim();
    if (!s) return {};
    if (s.startsWith("{")) { try { return JSON.parse(s); } catch { return null; } }
    const out: Record<string, string> = {};
    for (const line of s.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  };

  const triggerDispatch = async () => {
    const inputs = parseInputs(wfInputs);
    if (inputs === null) { onNotify?.("inputs geçersiz (KEY=VALUE satırları veya JSON)", "error"); return; }
    const wf = workflows.find((w) => String(w.id) === wfId);
    if (!window.confirm(`Workflow tetikle: ${wf?.name || wfId} @ ${wfRef}?`)) return;
    setDispatching(true);
    try {
      await api.post(`/api/github/actions/dispatch?repo=${encodeURIComponent(repo)}`, { workflowId: wfId, ref: wfRef, inputs });
      onNotify?.("Workflow tetiklendi", "success");
      setTimeout(() => loadRuns(repo, true), 2000);
    } catch (e) { onNotify?.(`Dispatch: ${String((e as Error)?.message || e)}`, "error"); }
    finally { setDispatching(false); }
  };

  const lowRate = data?.rateLimit && data.rateLimit.remaining < 10;
  const visibleRuns = (data?.runs || []).filter((r) => !failuresOnly || r.conclusion === "failure" || r.conclusion === "timed_out");

  // The expanded run is the "selected" one; the CI specialist diagnoses it from
  // its jobs/steps and the tail of whichever job log the user has opened (a failed
  // job wins). buildContext() → compact (<3800 char) metadata for POST /panel/:id.
  const selectedRun = expanded != null ? (data?.runs || []).find((r) => r.id === expanded) ?? null : null;
  const selectedJobs = expanded != null ? jobs[expanded] : undefined;
  const loadedLog = (() => {
    if (!selectedJobs) return null;
    const withLog = selectedJobs.filter((j) => logs[j.id] && !logs[j.id]!.loading && logs[j.id]!.text);
    if (withLog.length === 0) return null;
    return { job: withLog.find((j) => j.conclusion === "failure") ?? withLog[0]! };
  })();

  // Header'daki assist butonu dürüst şekilde disabled: run genişletilmemiş/seçili
  // değilse veya job log'u henüz yüklenmemişse teşhis edecek bir şey yok.
  const canDiagnose = Boolean(selectedRun && loadedLog);

  const buildContext = (): string => {
    const r = selectedRun;
    if (!r) return "Seçili çalışma yok — teşhis için bir workflow çalışmasını genişletin.";
    const head: string[] = [
      `RUN: ${r.name || r.display_title || "(workflow)"} #${r.run_number ?? "?"}`,
      `durum=${r.status || "?"} sonuç=${r.conclusion || "?"} dal=${r.head_branch || "?"} olay=${r.event || "?"}`,
    ];
    if (r.head_commit?.message) head.push(`commit: ${r.head_commit.message.split("\n")[0]}`);
    for (const j of selectedJobs || []) {
      head.push(`- job: ${j.name || "(job)"} → ${j.conclusion || j.status || "?"}`);
      for (const s of j.steps || []) {
        if (s.conclusion && s.conclusion !== "success") head.push(`    ✗ ${s.number}. ${s.name} · ${s.conclusion}`);
      }
    }
    const header = head.join("\n");
    if (!loadedLog) return header.slice(0, 3800);
    // Keep the log tail (diagnosis-critical) intact; trim the header if the sum overflows.
    const tail = (logs[loadedLog.job.id]?.text || "").slice(-2500);
    const block = `\nLOG (${loadedLog.job.name || "job"}, son ${tail.length} char):\n${tail}`;
    const headMax = Math.max(0, 3800 - block.length);
    return (header.length > headMax ? header.slice(0, headMax) : header) + block;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <GitBranch className="w-4 h-4 text-purple-400" />
        <span>GitHub Actions — workflow çalışmaları</span>
      </div>

      {/* eCy teşhis draweri artık diğer 4 panelle (Search/Integrations/ThreatIntel/Vault)
          tutarlı biçimde başlıkta — her zaman görünür, ama teşhis edilecek bir şey olana
          kadar dürüstçe disabled. AssistDrawer'ın kendi title'ı disabled butonda
          görünmediği için (Chrome/Safari) sarmalayıcı div'e neden-tooltip'i koyuyoruz;
          AssistDrawer.tsx'e dokunmuyoruz (başka bir agent orada çalışıyor). */}
      <div title={canDiagnose ? undefined : "Teşhis için bir workflow çalışmasını genişletin ve logunu yükleyin"}>
        <AssistDrawer
          panelId="github-actions"
          context={buildContext}
          label="eCy ile teşhis"
          disabled={!canDiagnose}
        />
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

      {data && (
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
            <input type="checkbox" checked={failuresOnly} onChange={(e: ChangeEvent<HTMLInputElement>) => setFailuresOnly(e.target.checked)} />
            sadece başarısızlar
          </label>
          {data.authed && (
            <button onClick={openTrigger} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
              <Play className="w-3 h-3" /> Workflow tetikle
            </button>
          )}
        </div>
      )}

      {showTrigger && data?.authed && (
        <div className="rounded border border-slate-700 bg-slate-900/40 p-3 space-y-2">
          <div className="text-xs text-slate-300">Workflow tetikle (workflow_dispatch)</div>
          <div className="flex gap-2">
            <select value={wfId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setWfId(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded border border-slate-600 bg-slate-900 text-sm text-slate-200">
              {workflows.length === 0 && <option value="">workflow yok</option>}
              {workflows.map((w) => <option key={w.id} value={String(w.id)}>{w.name || w.path}</option>)}
            </select>
            <input value={wfRef} onChange={(e: ChangeEvent<HTMLInputElement>) => setWfRef(e.target.value)} placeholder="ref (branch)"
              className="w-40 px-2 py-1.5 rounded border border-slate-600 bg-slate-900 text-sm text-slate-200 font-mono" />
          </div>
          <textarea value={wfInputs} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setWfInputs(e.target.value)} rows={2}
            placeholder="inputs (opsiyonel) — KEY=VALUE satırları veya JSON"
            className="w-full px-2 py-1.5 rounded border border-slate-600 bg-slate-900 text-xs text-slate-200 font-mono" />
          <button onClick={triggerDispatch} disabled={dispatching || !wfId}
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-950/40 text-sm disabled:opacity-40">
            {dispatching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Tetikle
          </button>
        </div>
      )}

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

      {data && visibleRuns.length === 0 && !err && <div className="text-slate-500 text-sm py-4 text-center">çalışma yok</div>}

      {data && visibleRuns.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded border border-slate-700">
          {visibleRuns.map((run) => {
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
                      {duration(run.created_at, run.updated_at) ? ` · ⏱ ${duration(run.created_at, run.updated_at)}` : ""}
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
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-mono ${stepCls(job.conclusion)}`}>{job.name} — {job.conclusion || job.status}</span>
                          <button onClick={() => loadLog(job.id)} title="Job log" className="text-slate-500 hover:text-sky-300"><FileText className="w-3 h-3" /></button>
                        </div>
                        <div className="ml-3">
                          {(job.steps || []).map((s, si) => (
                            <div key={si} className={`text-[10px] font-mono ${stepCls(s.conclusion)}`}>{s.number}. {s.name} · {s.conclusion || s.status}</div>
                          ))}
                        </div>
                        {logs[job.id] && (
                          <div className="ml-3 mt-1">
                            {logs[job.id]!.loading ? (
                              <div className="text-[10px] text-slate-500">log yükleniyor…</div>
                            ) : (
                              <>
                                {logs[job.id]!.truncated && <div className="text-[9px] text-amber-400">son 200 satır (kırpıldı)</div>}
                                <pre className="text-[10px] leading-snug bg-slate-950 border border-slate-800 rounded p-2 max-h-64 overflow-auto text-slate-300 whitespace-pre-wrap">{logs[job.id]!.text}</pre>
                              </>
                            )}
                          </div>
                        )}
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
