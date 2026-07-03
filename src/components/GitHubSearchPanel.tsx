import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Search, Loader2, ExternalLink, Star, AlertTriangle, CircleDot, GitPullRequest, FileCode2, FolderGit2 } from "lucide-react";
import { api } from "../lib/apiClient";

// "GitHub Arama" tab — first-party GitHub keyword search (repos / issues+PRs /
// code) over the REST Search API. Replaces the old external-iframe supervisor.
// repos/issues read unauthenticated; code search needs the github vault token.
// Search-on-submit only (the API's rate limit is tight); plain Turkish strings.

type SearchType = "repos" | "issues" | "code";
interface Repo { full_name?: string; description?: string | null; stargazers_count?: number; language?: string | null; html_url?: string; }
interface Issue { title?: string; state?: string; html_url?: string; number?: number; repository_url?: string; user?: { login?: string }; pull_request?: unknown; }
interface Code { name?: string; path?: string; html_url?: string; repository?: { full_name?: string }; }
interface Resp { ok: boolean; authed: boolean; type: SearchType; items: any[]; total: number; rateLimit?: { remaining: number; limit: number; reset: number }; error?: string; }

const TYPES: { id: SearchType; label: string; icon: any }[] = [
  { id: "repos", label: "Depolar", icon: FolderGit2 },
  { id: "issues", label: "Issue / PR", icon: CircleDot },
  { id: "code", label: "Kod", icon: FileCode2 },
];

// Only render an href we can vouch for — GitHub URLs. Anything else is dropped
// (defense-in-depth; React already escapes the text).
const safeUrl = (u?: string): string | undefined => {
  if (!u) return undefined;
  try { return new URL(u).origin === "https://github.com" ? u : undefined; } catch { return undefined; }
};
const repoFromUrl = (u?: string): string => (u ? u.replace(/^https?:\/\/api\.github\.com\/repos\//, "") : "");

export default function GitHubSearchPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [type, setType] = useState<SearchType>("repos");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (t: SearchType = type) => {
    const query = q.trim();
    if (!query) return;
    setBusy(true); setErr("");
    try {
      const d = await api.get<Resp>(`/api/github/search?type=${t}&q=${encodeURIComponent(query)}`);
      setData(d);
      if (!d.ok && d.error) setErr(d.error);
      else onNotify?.(`${d.total ?? 0} sonuç`, "info");
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };

  const pickType = (t: SearchType) => { setType(t); if (q.trim()) run(t); };

  const lowRate = data?.rateLimit && data.rateLimit.remaining < 3;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Search className="w-4 h-4 text-cyan-300" />
        <span>GitHub Arama — depo · issue · kod</span>
      </div>

      <div className="flex gap-1">
        {TYPES.map((t) => (
          <button key={t.id} onClick={() => pickType(t.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs transition ${type === t.id ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" : "text-slate-400 border border-transparent hover:bg-white/5"}`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") run(); }}
          placeholder="anahtar kelime + niteleyici (ör. ollama language:ts stars:>100)"
          className="flex-1 px-3 py-2 rounded border border-slate-600 bg-slate-900 text-sm text-slate-200 placeholder-slate-500"
        />
        <button onClick={() => run()} disabled={busy}
          className="flex items-center gap-1 px-3 py-2 rounded border border-slate-600 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Ara
        </button>
      </div>

      {err && (
        <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-950/20 border border-rose-800 rounded p-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{err}</span>
        </div>
      )}
      {lowRate && <div className="text-xs text-amber-300">GitHub arama kotası azaldı: {data!.rateLimit!.remaining}/{data!.rateLimit!.limit} kaldı.</div>}

      {data && data.ok && data.items.length === 0 && !err && <div className="text-slate-500 text-sm py-4 text-center">eşleşme yok</div>}

      {data && data.ok && data.items.length > 0 && (
        <>
          <div className="text-xs text-slate-500">{data.total.toLocaleString()} sonuç · ilk {data.items.length}</div>
          <ul className="divide-y divide-slate-800 rounded border border-slate-700">
            {type === "repos" && (data.items as Repo[]).map((r, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <a href={safeUrl(r.html_url)} target="_blank" rel="noopener noreferrer" className="text-sm text-cyan-300 hover:underline truncate flex items-center gap-1">
                    {r.full_name}{safeUrl(r.html_url) && <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />}
                  </a>
                  <span className="ml-auto flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
                    {r.language && <span>{r.language}</span>}
                    <span className="flex items-center gap-0.5"><Star className="w-3 h-3" />{(r.stargazers_count ?? 0).toLocaleString()}</span>
                  </span>
                </div>
                {r.description && <div className="text-[11px] text-slate-400 truncate">{r.description}</div>}
              </li>
            ))}
            {type === "issues" && (data.items as Issue[]).map((it, i) => (
              <li key={i} className="px-3 py-2 flex items-start gap-2">
                {it.pull_request ? <GitPullRequest className="w-3.5 h-3.5 mt-0.5 text-purple-400 shrink-0" /> : <CircleDot className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${it.state === "open" ? "text-emerald-400" : "text-rose-400"}`} />}
                <div className="min-w-0 flex-1">
                  <a href={safeUrl(it.html_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-200 hover:text-cyan-300 truncate flex items-center gap-1">
                    <span className="truncate">{it.title}</span>{safeUrl(it.html_url) && <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />}
                  </a>
                  <div className="text-[10px] text-slate-500 font-mono truncate">{repoFromUrl(it.repository_url)}#{it.number} · {it.state} · {it.user?.login}</div>
                </div>
              </li>
            ))}
            {type === "code" && (data.items as Code[]).map((c, i) => (
              <li key={i} className="px-3 py-2 flex items-center gap-2">
                <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <a href={safeUrl(c.html_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-200 hover:text-cyan-300 truncate flex items-center gap-1 min-w-0">
                  <span className="text-slate-500">{c.repository?.full_name}</span><span className="truncate">/{c.path}</span>{safeUrl(c.html_url) && <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
